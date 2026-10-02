const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { revisionMessages, installRevision } = require('../revision-main');
const input = { requestId: 'request', bookId: 'book', action: 'rewrite', profileId: 'local', model: 'fixture', selection: 'Selected prose.', before: 'Earlier prose.', after: 'Later prose.', instruction: '' };
test('revision prompts keep excerpts separate, bound input and require custom direction', () => {
  const messages = revisionMessages(input, 'Keep the voice.');
  assert.match(messages[0].content, /Keep the voice/);
  assert.deepEqual(JSON.parse(messages[1].content.split('Source excerpts (JSON strings):\n')[1]), { before: input.before, selection: input.selection, after: input.after });
  for (const field of ['selection', 'before', 'after', 'instruction']) assert.throws(() => revisionMessages({ ...input, [field]: 'x'.repeat(40001) }, ''), /too long/);
  assert.throws(() => revisionMessages({ ...input, selection: ' ' }, ''), /Select text/);
  assert.throws(() => revisionMessages({ ...input, action: 'custom' }, ''), /Describe/);
  assert.throws(() => revisionMessages({ ...input, action: 'unknown' }, ''), /Choose/);
});
test('revision IPC rejects other windows, subframes, stale books and context overflow; cancellation rejects late results', async () => {
  const handlers = {}, sender = new EventEmitter(); sender.id = 1;
  sender.mainFrame = { url: pathToFileURL(path.resolve(__dirname, '../index.html')).href };
  const event = { sender, senderFrame: sender.mainFrame };
  let bookId = 'book', limit = null, release, calls = 0;
  installRevision({ ipcMain: { handle: (name, fn) => handlers[name] = fn }, paneWindows: { isOwner: e => e.sender === sender, getSnapshot: () => ({ bookId }) }, assistants: { instructions: () => 'Fixture instructions' }, connections: {
    snapshot: () => ({ profiles: [{ id: 'local' }] }), contextCapacity: () => ({ limit }),
    generate: () => { calls++; return new Promise(resolve => { release = resolve; }); }
  } });
  const generate = handlers['revision:generate'];
  assert.match((await generate({ sender: {} }, input)).error, /workspace/);
  assert.match((await generate({ sender, senderFrame: { url: sender.mainFrame.url } }, input)).error, /workspace/);
  bookId = 'other'; assert.match((await generate(event, input)).error, /book changed/); bookId = 'book';
  limit = 100; assert.match((await generate(event, input)).error, /context limit/); limit = null;
  assert.equal(calls, 0);
  const pending = generate(event, input);
  assert.match((await generate(event, input)).error, /Stop the current/);
  await handlers['revision:cancel'](event, input.requestId); release('Late prose');
  assert.match((await pending).error, /stopped/);
  assert.equal(sender.listenerCount('destroyed'), 0);
});
