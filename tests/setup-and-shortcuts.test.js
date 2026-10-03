const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { selectProfile } = require('../fresh-profile');
const { validate, snapshot } = require('../keyboard-shortcuts');
const { composeUrl, openCompose } = require('../email-draft');

test('fresh setup preserves original files, selects an empty library, and persists across launches', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-fresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'settings.json'), '{"author":"Original"}');
  const docs = path.join(root, 'documents'); fs.mkdirSync(docs);
  fs.mkdirSync(path.join(docs, 'Neo-AI Library'));
  fs.writeFileSync(path.join(docs, 'Neo-AI Library', 'book.txt'), 'Keep this book');
  assert.equal(selectProfile(root, docs), root);
  fs.writeFileSync(path.join(root, 'fresh-setup-request'), 'fresh');
  const first = selectProfile(root, docs);
  assert.notEqual(first, root); assert.equal(selectProfile(root, docs), first);
  const settings = JSON.parse(fs.readFileSync(path.join(first, 'settings.json')));
  assert.equal(settings.initializeLibrary, true); assert.equal(fs.existsSync(settings.libraryDir), false);
  assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{"author":"Original"}');
  assert.equal(fs.readFileSync(path.join(docs, 'Neo-AI Library', 'book.txt'), 'utf8'), 'Keep this book');
  fs.writeFileSync(path.join(root, 'fresh-setup-request'), 'fresh again');
  assert.notEqual(selectProfile(root, docs), first);
});
test('profile pointer cannot escape profile directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-fresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'profile-location.json'), JSON.stringify({ id: '../../elsewhere' }));
  assert.throws(() => selectProfile(root, root), /Invalid/);
});
test('shortcuts accept valid changes and reject conflicts and editing keys', () => {
  assert.deepEqual(validate({}), {}); assert.deepEqual(validate({}, 'darwin'), {});
  assert.equal(validate({ searchBook: 'Shift+Control+G' }).searchBook, 'Control+Shift+G');
  assert.throws(() => validate({ searchBook: 'Control+F' }), /already used/);
  assert.throws(() => validate({ find: 'Control+C' }), /reserved/);
  assert.throws(() => validate({ find: 'G' }), /Include/);
  assert.throws(() => validate({ unknown: 'F4' }), /Unknown/);
  assert.equal(snapshot(validate({ find: '', searchBook: 'Control+F' })).find(row => row.id === 'find').accelerator, '');
});
test('email chooser encodes recipients and content and reports launch failure without sending', async () => {
  const message = { to: 'reader@example.com', subject: 'Draft & notes', body: 'Attach this PDF.\nReview first.' };
  for (const method of ['default', 'gmail', 'outlook']) {
    const url = composeUrl(method, message);
    assert.ok(url.includes('Draft%20%26%20notes'));
    assert.ok(!url.includes('\n'));
  }
  assert.throws(() => composeUrl('unknown', message), /Choose/);
  assert.throws(() => composeUrl('default', { ...message, to: 'bad\naddress' }), /valid/);
  const calls = [];
  const result = await openCompose({ openExternal: async url => { calls.push(url); throw Error('No handler'); }, showItemInFolder: file => calls.push(file) }, 'default', message, 'draft.pdf');
  assert.equal(result.ok, false); assert.equal(result.manualAttachment, true);
  assert.equal(calls[1], 'draft.pdf');
});
