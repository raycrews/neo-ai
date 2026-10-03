const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { backupStatus, createBackup, readBackup, restoreBackup } = require('../library-backups');
const { backupControls } = require('../backup-controls');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-backup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, 'library'); fs.mkdirSync(path.join(library, 'book', 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(library, 'library.json'), JSON.stringify({ shelves: [{ bookIds: ['book'] }] }));
  fs.writeFileSync(path.join(library, 'book', 'book.json'), JSON.stringify({ title: 'Test novel' }));
  fs.writeFileSync(path.join(library, 'book', 'chapters', 'scene.html'), '<h1>A scene</h1><p>Saved text.</p>');
  fs.writeFileSync(path.join(library, 'book', 'ai-chats.json'), '{"conversations":[]}');
  return { root, library };
}

test('backup round trip preserves plain files and restores separate copies without overwriting', async t => {
  const { root, library } = fixture(t);
  fs.mkdirSync(path.join(library, 'Exports')); fs.writeFileSync(path.join(library, 'Exports', 'omit.txt'), 'export');
  const status = await createBackup(library);
  const backup = await readBackup(path.join(status.directory, status.latest.name));
  assert.deepEqual(backup.titles, ['Test novel']); assert.equal(backup.files.size, 4);
  const restored = restoreBackup(backup, root), second = restoreBackup(backup, root);
  assert.notEqual(restored, second); assert.notEqual(restored, library);
  for (const [name, bytes] of backup.files) assert.deepEqual(fs.readFileSync(path.join(restored, name)), bytes);
  assert.equal(fs.readFileSync(path.join(library, 'book', 'chapters', 'scene.html'), 'utf8'), '<h1>A scene</h1><p>Saved text.</p>');
});

test('daily retention keeps 14 dates, never prunes manual or unrelated archives', async t => {
  const { library } = fixture(t);
  await createBackup(library); const directory = backupStatus(library).directory;
  fs.writeFileSync(path.join(directory, 'neo-backup-important.zip'), 'keep');
  for (let day = 1; day <= 16; day++) await createBackup(library, { daily: true, now: new Date(Date.UTC(2026, 8, day)) });
  await createBackup(library, { daily: true, now: new Date(Date.UTC(2026, 8, 16)) });
  assert.equal(backupStatus(library).count, 15);
  assert.equal(fs.existsSync(path.join(directory, 'neo-backup-2026-09-01.zip')), false);
  assert.equal(fs.existsSync(path.join(directory, 'neo-backup-important.zip')), true);
});

test('invalid, unsafe, incomplete and damaged archives fail before extraction', async t => {
  const { root } = fixture(t), target = path.join(root, 'bad.zip');
  async function check(zip, pattern) {
    fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    await assert.rejects(readBackup(target), pattern);
  }
  await check(new JSZip().file('../escape.txt', 'unsafe'), /unsafe/);
  await check(new JSZip().file('C:/escape.txt', 'unsafe'), /unsafe/);
  await check(new JSZip().file('alias', 'target', { unixPermissions: 0o120777 }).file('library.json', '{}'), /linked/);
  await check(new JSZip().file('library.json', '{}'), /catalog/);
  await check(new JSZip().file('library.json', JSON.stringify({ shelves: [{ bookIds: ['missing'] }] })), /missing readable/);
  await check(new JSZip().file('Library.json', '{}').file('library.json', '{}'), /conflicting/);
  await check(new JSZip().file('folder', 'file').file('folder/child', 'child'), /conflicting/);
  const raw = await new JSZip().file('library.json', '{"shelves":[]}').generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const index = raw.indexOf(Buffer.from('{"shelves":[]}')); raw[index + 2] = 'S'.charCodeAt(0);
  fs.writeFileSync(target, raw); await assert.rejects(readBackup(target), /damaged/);
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
});

test('failed archive writes retain previous backup and leave no partial ZIP', async t => {
  const { library } = fixture(t);
  const before = await createBackup(library);
  const original = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('Fixture disk unavailable'); };
    await assert.rejects(createBackup(library), /disk unavailable/);
  } finally { fs.renameSync = original; }
  assert.equal(backupStatus(library).count, 1);
  assert.deepEqual(fs.readdirSync(before.directory), [before.latest.name]);
});

test('controls flush before snapshot, serialize jobs, cancel safely and preserve current library on restore', async t => {
  const { root, library } = fixture(t); let release, selected, response = 0, opened;
  const controls = backupControls({ getLibraryPath: () => library,
    flush: () => new Promise(resolve => { release = () => { fs.writeFileSync(path.join(library, 'draft.txt'), 'latest edit'); resolve(); }; }),
    shell: { openPath: async () => '' }, openLibrary: async directory => { opened = directory; },
    dialog: { showOpenDialog: async () => selected ? { filePaths: [selected] } : { canceled: true }, showMessageBox: async () => ({ response }) }
  });
  const job = controls.create(); await assert.rejects(controls.create(), /already in progress/); release(); await job;
  const status = controls.status(); selected = path.join(status.directory, status.latest.name);
  const backup = await readBackup(selected); assert.equal(backup.files.get('draft.txt').toString(), 'latest edit');
  assert.equal((await controls.restore({})).canceled, true);
  response = 1;
  // Switch the picker from ZIP to destination after preview.
  const originalSelected = selected;
  const restoredControls = backupControls({ getLibraryPath: () => library, flush: async () => {}, shell: {}, openLibrary: async p => { opened = p; },
    dialog: { showOpenDialog: async (_win, options) => ({ filePaths: [options.properties.includes('openFile') ? originalSelected : root] }), showMessageBox: async () => ({ response: 1 }) } });
  const result = await restoredControls.restore({});
  assert.equal(path.dirname(fs.realpathSync(result.restored)), fs.realpathSync(root));
  assert.equal(opened, undefined); await restoredControls.openRestored(); assert.equal(opened, result.restored);
  assert.equal(fs.existsSync(path.join(library, 'library.json')), true);
});
