const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateText } = require('../ai-stream');
const { ChatStore, history } = require('../ai-chat-store');
const { atomicJSON } = require('../protected-storage');
const { exportConversation } = require('../chat-export');
test('chat export includes the original transcript and partial/error status as literal text', () => {
  const conversation = { title: 'Plot ideas', summary: { text: 'Short memory', throughId: 'old' }, draft: 'Do not export this draft', messages: [
    { id: 'old', role: 'user', content: 'Earlier question\nSecond line', status: 'complete' },
    { role: 'assistant', model: 'fixture', content: '<script>literal model text</script>', status: 'stopped' },
    { role: 'assistant', content: '', status: 'error', error: 'HTTP 401.' }
  ] };
  const exported = exportConversation(conversation);
  assert.equal(exported.title, 'Plot ideas');
  assert.ok(exported.text.includes('Earlier question\nSecond line'));
  assert.ok(exported.text.includes('Assistant (fixture)'));
  assert.ok(exported.text.includes('<script>literal model text</script>'));
  assert.ok(exported.text.includes('[Reply stopped]') && exported.text.includes('[Reply failed]') && exported.text.includes('HTTP 401.'));
  assert.ok(!exported.text.includes('Do not export this draft') && !exported.text.includes('Short memory'));
  assert.throws(() => exportConversation({ messages: [] }), /no messages/);
});
function stream(value, step = 3) {
  const bytes = Buffer.from(value); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) return controller.close();
    controller.enqueue(bytes.subarray(offset, offset += Math.min(step, bytes.length - offset)));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function call(fetchImpl, api = 'chat', extra = {}) {
  return generateText({ fetchImpl, profile: { api, baseUrl: 'http://localhost/v1' }, key: 'fixture-secret',
    model: 'fixture', messages: [{ role: 'user', content: 'Hello' }], onText: () => {}, ...extra });
}
test('Chat Completions parses split UTF-8 and CRLF events, redacts split credentials and sends history', async () => {
  const output = []; let body;
  const events = ['Café 🌙 ', 'fixture-', 'secret', ' complete'].map(content => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n').join('');
  const result = await call(async (_url, options) => { body = JSON.parse(options.body); assert.equal(options.redirect, 'error'); return stream(': heartbeat\r\n\r\n' + events + 'data: [DONE]\r\n\r\n'); }, 'chat', { onText: text => output.push(text) });
  assert.equal(result, 'Café 🌙 [redacted] complete');
  assert.ok(output.every(text => !text.includes('fixture-secret')));
  assert.equal(body.stream, true); assert.equal(body.messages[0].content, 'Hello');
});
test('Responses streams semantic events and remains stateless', async () => {
  const result = await call(async (url, options) => {
    assert.match(url, /\/responses$/); assert.equal(JSON.parse(options.body).store, false);
    return stream('data: {"type":"response.output_text.delta","delta":"Ready"}\n\ndata: {"type":"response.completed"}\n\n');
  }, 'responses');
  assert.equal(result, 'Ready');
});
test('truncated streams and provider failures retain partial text and never echo raw error bodies', async () => {
  let partial;
  await assert.rejects(call(async () => stream('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'), 'chat', { onText: text => partial = text }), /ended unexpectedly/);
  assert.equal(partial, 'Partial');
  await assert.rejects(call(async () => stream('data: {"error":{"message":"fixture-secret private"}}\n\n')), error => !error.message.includes('fixture-secret') && /could not finish/.test(error.message));
  await assert.rejects(call(async () => new Response('fixture-secret', { status: 401 })), /HTTP 401/);
});
function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const connections = { snapshot: () => ({ defaultId: 'local', profiles: [{ id: 'local', model: 'fixture' }] }),
    generate: async request => { requests.push(request); request.onText('A suggestion.'); return 'A suggestion.'; } };
  const store = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections, ...overrides });
  return { store, dir, requests, connections };
}
test('each chat retains its assistant type and reads current instructions on send while compaction stays neutral', async t => {
  let instructions = 'Explore character motivations.';
  const { store, requests, dir, connections } = fixture(t, { instructionsFor: type => type === 'characters' ? instructions : 'General instructions.' });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'assistant', id, assistantType: 'characters' });
  await assert.rejects(store.action('one', { type: 'assistant', id, assistantType: '../bad' }), /valid assistant/);
  await store.action('one', { type: 'send', id, text: 'Develop Sarah' }); await store.flush('one');
  assert.match(requests.at(-1).messages[0].content, /Explore character motivations/);
  assert.match(requests.at(-1).messages[0].content, /Only book documents explicitly attached/);
  instructions = 'Ask about character relationships.';
  await store.action('one', { type: 'send', id, text: 'Next' }); await store.flush('one');
  assert.match(requests.at(-1).messages[0].content, /Ask about character relationships/);
  assert.doesNotMatch(requests.at(-1).messages[0].content, /Explore character motivations/);
  await store.action('one', { type: 'send', id, text: 'More' }); await store.flush('one');
  await store.action('one', { type: 'compact', id }); await store.flush('one');
  assert.doesNotMatch(requests.at(-1).messages[0].content, /Ask about character relationships/);
  const next = await store.action('one', { type: 'new' });
  assert.equal(next.conversations.find(c => c.id === next.selectedId).assistantType, 'general');
  const reopened = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections });
  assert.equal(reopened.read('one').conversations.find(c => c.id === id).assistantType, 'characters');
  // Older saved chats receive the general type without rewriting their content.
  const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'one.json')));
  for (const c of legacy.conversations) delete c.assistantType;
  fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(legacy));
  assert.equal(reopened.read('legacy').conversations[0].assistantType, 'general');
});
test('conversations persist per book with partial replies, drafts, selections and provider identity', async t => {
  const { store, dir, connections } = fixture(t);
  const first = await store.action('one', { type: 'new' }); const id = first.selectedId;
  await store.action('one', { type: 'send', id, text: 'An opening idea' }); await store.jobs.get(store.key('one'))?.done;
  await store.action('one', { type: 'draft', id, text: 'Next question' });
  await store.action('two', { type: 'new' });
  const reopened = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections });
  assert.equal(reopened.state('one').conversations[0].draft, 'Next question');
  assert.equal(reopened.state('one').conversations[0].messages[1].model, 'fixture');
  assert.equal(reopened.state('two').conversations[0].messages.length, 0);
  assert.throws(() => reopened.state('../one'), /Invalid book/);
});
test('manual compaction previews editable memory, keeps originals and sends summary plus recent turns', async t => {
  const { store, requests } = fixture(t); const id = (await store.action('one', { type: 'new' })).selectedId;
  for (let n = 0; n < 4; n++) { await store.action('one', { type: 'send', id, text: 'Idea ' + n }); await store.jobs.get(store.key('one'))?.done; }
  const originals = structuredClone(store.read('one').conversations[0].messages);
  await store.action('one', { type: 'compact', id }); await store.jobs.get(store.key('one'))?.done;
  let c = store.read('one').conversations[0]; assert.equal(c.summary, null); assert.equal(c.preview.status, 'complete');
  await store.action('one', { type: 'applySummary', id, text: 'Author rejected Idea 0; Idea 1 remains a proposal.' });
  c = store.read('one').conversations[0]; assert.deepEqual(c.messages, originals);
  const active = history(c); assert.equal(active.length, 6); assert.ok(active[1].content.includes('rejected Idea 0'));
  assert.equal(active[2].content, 'Idea 2');
  await store.action('one', { type: 'send', id, text: 'Continue' }); await store.jobs.get(store.key('one'))?.done;
  assert.equal(requests.at(-1).messages[1].content.includes('rejected Idea 0'), true);
  await store.action('one', { type: 'restore', id }); assert.equal(history(store.read('one').conversations[0]).length, 11);
});
test('stopping keeps partial replies; failed writes protect the previous saved state; corrupt files are untouched', async t => {
  const { store, dir, connections } = fixture(t);
  connections.generate = request => new Promise((_resolve, reject) => { request.onText('Partial draft'); request.signal.addEventListener('abort', () => reject(new Error('Reply stopped.')), { once: true }); });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'send', id, text: 'Start' });
  await store.action('one', { type: 'stop' });
  const reply = store.read('one').conversations[0].messages[1]; assert.equal(reply.status, 'stopped'); assert.equal(reply.content, 'Partial draft');
  store.write = () => { throw new Error('Disk error'); };
  await assert.rejects(store.action('one', { type: 'rename', id, text: 'Lost rename' }), /Disk error/);
  assert.equal(store.read('one').conversations[0].title, 'Start');
  store.write = atomicJSON;
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{invalid');
  await assert.rejects(store.action('bad', { type: 'new' }), /left unchanged/); assert.equal(fs.readFileSync(bad, 'utf8'), '{invalid');
});

test('chat resolves chosen live sources on each send without saving or compacting source text', async t => {
  let text = 'Original source-only prose', enabled = true;
  const { store, dir, requests, connections } = fixture(t, { resolveContext: async () => [
    { id: 'hero', section: 'characters', path: 'Characters / Elara', enabled, text },
    { id: 'cut', section: 'darlings', path: 'Darlings / Cut scene', enabled: true, text: 'Excluded darling' }
  ] });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'context', id, ids: ['hero', 'cut'] });
  async function send(prompt) { await store.action('one', { type: 'send', id, text: prompt, sources: [{ text: 'Forged source' }] }); await store.jobs.get(store.key('one'))?.done; }
  await send('Use the character');
  assert.ok(JSON.stringify(requests.at(-1).messages).includes(text));
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('Forged source'));
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('Excluded darling'));
  const user = store.read('one').conversations[0].messages[0];
  assert.deepEqual(user.contextSources, [{ id: 'hero', path: 'Characters / Elara' }]);
  assert.equal(user.contextOmitted, 1);
  const persisted = fs.readFileSync(path.join(dir, 'one.json'), 'utf8'); assert.ok(!persisted.includes(text));
  const reopened = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections });
  assert.deepEqual(reopened.state('one').conversations[0].contextIds, ['hero', 'cut']);
  text = 'Latest unsaved source-only prose'; await send('Use the latest text');
  assert.ok(JSON.stringify(requests.at(-1).messages).includes(text));
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('Original source-only prose'));
  enabled = false; await send('Excluded now');
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes(text));
  await store.action('one', { type: 'compact', id }); await store.jobs.get(store.key('one'))?.done;
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('source-only prose'));
  await store.action('one', { type: 'context', id, ids: [] }); await send('History only');
  assert.equal(requests.at(-1).messages.length, 8);
});

test('queued sends preserve drafts and selection changes during a context read; failed reads send nothing', async t => {
  let release;
  const { store, requests } = fixture(t, { resolveContext: () => new Promise(resolve => { release = resolve; }) });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'context', id, ids: ['hero'] });
  const send = store.action('one', { type: 'send', id, text: 'Waiting for context' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const draft = store.action('one', { type: 'draft', id, text: 'Keep this next draft' });
  release([]); await send; await draft; await store.jobs.get(store.key('one'))?.done;
  assert.equal(store.state('one').conversations[0].draft, 'Keep this next draft');
  store.resolveContext = async () => { throw new Error('Workspace changed'); };
  const before = store.state('one');
  await assert.rejects(store.action('one', { type: 'send', id, text: 'Fail safely' }), /Workspace changed/);
  assert.deepEqual(store.state('one'), before); assert.equal(requests.length, 1);
});

test('navigation linking is idempotent, retains folder creation and repairs a failed navigation save', async t => {
  const nodes = new Map(); let fail = true;
  const { store, dir, connections } = fixture(t, { syncNavigation: async (_book, chats) => {
    if (fail) throw new Error('Navigation write failed');
    for (const c of chats) if (nodes.has(c.id) || !c.linked) nodes.set(c.id, { title: c.title, parentId: nodes.get(c.id)?.parentId || c.parentId });
    return [...nodes.keys()];
  } });
  await assert.rejects(store.action('one', { type: 'new', title: 'Sarah', parentId: 'folder-cast' }), /Navigation write failed/);
  const id = store.read('one').conversations[0].id;
  assert.equal(store.read('one').conversations[0].navigationLinked, undefined);
  fail = false; await store.action('one', { type: 'syncNavigation' });
  assert.equal(nodes.size, 1); assert.equal(nodes.get(id).parentId, 'folder-cast');
  assert.equal(store.read('one').conversations[0].navigationLinked, true);
  await store.action('one', { type: 'rename', id, text: 'Sarah Vance' });
  assert.equal(nodes.size, 1); assert.equal(nodes.get(id).title, 'Sarah Vance');
  const reopened = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections, syncNavigation: store.syncNavigation });
  await reopened.action('one', { type: 'syncNavigation' }); assert.equal(nodes.size, 1);
  nodes.delete(id); await reopened.action('one', { type: 'syncNavigation' });
  assert.equal(nodes.size, 0); assert.equal(reopened.read('one').conversations[0].title, 'Sarah Vance');
});

test('a navigation failure after send does not turn a saved prompt into an unsent draft', async t => {
  let fail = false;
  const { store } = fixture(t, { syncNavigation: async (_book, chats) => { if (fail) throw new Error('Navigation unavailable'); return chats.map(c => c.id); } });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  fail = true;
  await store.action('one', { type: 'send', id, text: 'Keep my sent message' }); await store.jobs.get(store.key('one'))?.done;
  const c = store.read('one').conversations[0];
  assert.equal(c.draft, ''); assert.equal(c.messages[0].content, 'Keep my sent message');
  assert.equal(c.messages[1].status, 'complete'); assert.match(c.error, /Navigation unavailable/);
});

test('context budget includes live instructions, sources, drafts, reply allowance and editable summary without sending', async t => {
  let source = 'Live character facts. '.repeat(50), instructions = 'Use character instructions.';
  const { store, requests, connections, dir } = fixture(t, {
    instructionsFor: () => instructions,
    resolveContext: async () => [{ id: 'hero', enabled: true, section: 'characters', path: 'Characters / Hero', text: source }]
  });
  connections.contextCapacity = () => ({ limit: 8192, source: 'manual' });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'context', id, ids: ['hero', 'missing'] });
  for (let n = 0; n < 4; n++) { await store.action('one', { type: 'send', id, text: 'A long thought '.repeat(100) }); await store.jobs.get(store.key('one'))?.done; }
  await store.action('one', { type: 'compact', id }); await store.jobs.get(store.key('one'))?.done;
  const count = requests.length, before = fs.readFileSync(path.join(dir, 'one.json'), 'utf8');
  const report = await store.inspect('one', id, 'Draft question', 'A short summary.');
  assert.equal(requests.length, count); assert.equal(fs.readFileSync(path.join(dir, 'one.json'), 'utf8'), before);
  assert.ok(report.current.parts.instructions > 0 && report.current.parts.documents > 200);
  assert.equal(report.current.parts.summary, 0); assert.equal(report.current.parts.draft, 4);
  assert.equal(report.current.reply, 4096); assert.equal(report.current.total, report.current.input + 4096);
  assert.equal(report.current.remaining, 8192 - report.current.total); assert.equal(report.current.omitted, 1);
  assert.equal(report.proposed.summarizedMessages, 4); assert.equal(report.proposed.recentMessages, 4);
  assert.ok(report.proposed.input < report.current.input);
  const longer = await store.inspect('one', id, 'Draft question', 'A long summary '.repeat(200));
  assert.ok(longer.proposed.input > report.proposed.input);
  instructions += 'More detailed instructions.'.repeat(20); source += 'New facts. '.repeat(100);
  const fresh = await store.inspect('one', id, '', 'A short summary.');
  assert.ok(fresh.current.parts.instructions > report.current.parts.instructions);
  assert.ok(fresh.current.parts.documents > report.current.parts.documents);
  await store.action('one', { type: 'applySummary', id, text: 'A short summary.' });
  const applied = await store.inspect('one', id, '', '');
  assert.equal(applied.current.summarizedMessages, 4); assert.equal(applied.proposed, null);
  await store.action('one', { type: 'send', id, text: 'Continue' }); await store.jobs.get(store.key('one'))?.done;
  assert.ok(JSON.stringify(requests.at(-1).messages).includes(source));
  assert.ok(!fs.readFileSync(path.join(dir, 'one.json'), 'utf8').includes(source));
  await assert.rejects(store.inspect('one', id, 'x'.repeat(100001)), /too long/);
});


test('reply settings reach both streaming APIs and omitted temperature stays provider default', async () => {
  for (const api of ['chat', 'responses']) {
    let body;
    const fetch = async (_url, options) => { body = JSON.parse(options.body); return stream(api === 'responses' ? 'data: {"type":"response.output_text.delta","delta":"Ready"}\n\ndata: {"type":"response.completed"}\n\n' : 'data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n'); };
    await call(fetch, api, { settings: { maxReplyTokens: 1700, temperature: 0.65 } });
    assert.equal(body[api === 'chat' ? 'max_tokens' : 'max_output_tokens'], 1700);
    assert.equal(body.temperature, 0.65);
    await call(fetch, api); assert.equal('temperature' in body, false);
  }
});

test('context estimates use saved reply limits without generation', async t => {
  const { store, connections, requests } = fixture(t);
  let maxReplyTokens = 1000; connections.responseSettings = () => ({ maxReplyTokens, temperature: null });
  const id = (await store.action('one', { type: 'new' })).selectedId;
  const first = await store.inspect('one', id, 'hello');
  assert.equal(first.current.reply, 1000);
  maxReplyTokens = 6000;
  const second = await store.inspect('one', id, 'hello');
  assert.equal(second.current.total - first.current.total, 5000);
  assert.equal(requests.length, 0);
});

test('retry and revised prompts create saved chats without losing originals or later history leaking into requests', async t => {
  const { store, requests, dir, connections } = fixture(t);
  const id = (await store.action('one', { type: 'new' })).selectedId;
  await store.action('one', { type: 'assistant', id, assistantType: 'characters' });
  for (const text of ['Opening', 'Middle', 'Later secret', 'Ending']) {
    await store.action('one', { type: 'send', id, text }); await store.flush('one');
  }
  await store.action('one', { type: 'compact', id }); await store.flush('one');
  await store.action('one', { type: 'applySummary', id, text: 'Summary of opening and middle.' });
  await store.action('one', { type: 'draft', id, text: 'Keep my unfinished draft' });
  const original = structuredClone(store.read('one').conversations[0]);
  const retried = await store.action('one', { type: 'retry', id, messageId: original.messages[1].id }); await store.flush('one');
  assert.notEqual(retried.selectedId, id);
  assert.deepEqual(store.read('one').conversations[0], original);
  let branch = store.read('one').conversations.find(c => c.id === retried.selectedId);
  assert.equal(branch.summary, null); assert.equal(branch.messages.length, 2);
  assert.equal(branch.assistantType, 'characters'); assert.equal(branch.model, original.model);
  assert.equal(requests.at(-1).messages.at(-1).content, 'Opening');
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('Later secret'));
  const revised = await store.action('one', { type: 'resend', id, messageId: original.messages[6].id, text: 'Revised ending' }); await store.flush('one');
  branch = store.read('one').conversations.find(c => c.id === revised.selectedId);
  assert.deepEqual(branch.summary, original.summary); assert.equal(branch.preview, null);
  assert.equal(requests.at(-1).messages.at(-1).content, 'Revised ending');
  assert.deepEqual(store.read('one').conversations[0], original);
  const count = store.read('one').conversations.length;
  await assert.rejects(store.action('one', { type: 'retry', id, messageId: original.messages[0].id }), /saved prompt/);
  await assert.rejects(store.action('one', { type: 'resend', id, messageId: original.messages[0].id, text: '  ' }), /Write a message/);
  assert.equal(store.read('one').conversations.length, count);
  const reopened = new ChatStore({ fileFor: id => path.join(dir, id + '.json'), connections });
  assert.deepEqual(reopened.read('one').conversations[0], original);
  assert.equal(reopened.read('one').selectedId, revised.selectedId);
  assert.equal(reopened.read('one').conversations.at(-1).messages.at(-2).content, 'Revised ending');
});
