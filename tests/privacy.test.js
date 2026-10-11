const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { isPrivatePath, checkRepository, checkPackage } = require('../build/privacy-check.cjs');

async function scratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-privacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const privateFiles = [
  'settings.json', 'saved/ai-connections.json', 'ai-assistants.json',
  'instruction-library.json', 'library.json', 'ai-chats.json', 'secrets.json',
  'profile-location.json', 'fresh-setup-request', 'book.json', 'darlings.json',
  'stickies.json', 'art.json', 'settings.json.old', 'saved/book.json.uuid.tmp',
  'book-one/chapters/one.html', 'copy/NEO Library/notes.html',
  'Neo-AI Library-123/outline.html', 'profiles/123/Cookies', 'userData/Local State',
  'Backups/anything.zip', 'Exports/draft.pdf', 'neo-manual-2026-10-11.zip',
  'copy/.env.local', '.env', '.ssh/config', '.aws/credentials', 'signing.p12',
];

test('rejects saved data and credentials while allowing application source and fixtures', () => {
  for (const file of privateFiles) assert.ok(isPrivatePath(file), file);
  assert.ok(isPrivatePath('COPY\\SETTINGS.JSON.BAK'));
  for (const file of ['settings.js', 'settings.html', 'instruction-library.js',
    'tests/ai-chat.test.js', 'scripts/test-chat.cjs', 'book-search.js',
    'package.json', 'locales/en.json', 'build/entitlements.mac.plist']) {
    assert.equal(isPrivatePath(file), false, file);
  }
});

test('Git ignores and packaging exclusions cover the private data examples', async t => {
  const root = await scratch(t);
  const ignore = await fs.readFile(path.join(__dirname, '../.gitignore'));
  await fs.writeFile(path.join(root, '.gitignore'), ignore);
  execFileSync('git', ['init', '--quiet', root]);
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
    cwd: root, input: privateFiles.join('\0') + '\0', encoding: 'utf8',
  }).split('\0').filter(Boolean);
  assert.deepEqual(ignored, privateFiles);
  const exclusions = require('../package.json').build.files.filter(p => p.startsWith('!')).map(p => p.slice(1));
  for (const file of privateFiles) {
    assert.ok(exclusions.some(pattern => path.posix.matchesGlob(file, pattern)), file);
  }
});

test('Git check catches a force-added ignored file without revealing its contents', async t => {
  const root = await scratch(t);
  execFileSync('git', ['init', '--quiet', root]);
  await fs.writeFile(path.join(root, '.gitignore'), 'settings.json\n');
  await fs.writeFile(path.join(root, 'settings.json'), 'private-content-must-not-be-printed');
  assert.equal(checkRepository(root), 0);
  execFileSync('git', ['add', '-f', 'settings.json'], { cwd: root });
  assert.throws(() => checkRepository(root), error =>
    error.message.includes('settings.json') && !error.message.includes('private-content'));
});

test('package check rejects data inside ASAR, unpacked files, and loose resources', async t => {
  const root = await scratch(t);
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  await fs.mkdir(source); await fs.mkdir(output);
  await fs.writeFile(path.join(source, 'main.js'), 'module.exports = {};');
  await asar.createPackage(source, path.join(output, 'app.asar'));
  assert.ok(await checkPackage(output));
  for (const file of ['settings.json', 'app.asar.unpacked/ai-connections.json', 'Backups/copy.zip']) {
    const dest = path.join(output, file);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, 'fixture-only');
    await assert.rejects(checkPackage(output), /possible personal data/);
    await fs.unlink(dest);
  }
  await fs.writeFile(path.join(source, 'ai-chats.json'), 'fixture-only');
  await asar.createPackage(source, path.join(output, 'app.asar'));
  await assert.rejects(checkPackage(output), /ai-chats\.json/);
});
