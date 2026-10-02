const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Connections, validateProfile } = require('../ai-connections');
const { protectedStorage, legacySecretStore } = require('../protected-storage');
// Reversible test double only; production uses Electron's OS-backed safeStorage.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from([...text].reverse().join('')),
  decryptString: data => [...data.toString()].reverse().join(''),
  getSelectedStorageBackend: () => 'gnome_libsecret'
};
const protector = protectedStorage(safeStorage, 'linux');
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-connections-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = () => path.join(dir, 'ai-connections.json');
  return { file, service: new Connections({ file, protector, ...options }) };
}
const profile = (extra = {}) => ({ name: 'Local', provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1', api: 'chat', model: 'test-model', ...extra });

test('model capacities use loaded limits, persist manual overrides per model, and clear after endpoint changes', async t => {
  const { file, service } = fixture(t, { fetchImpl: async url => new Response(JSON.stringify(url.endsWith('/api/v1/models')
    ? { models: [{ type: 'llm', key: 'test-model', max_context_length: 131072, loaded_instances: [{ id: 'test-model', config: { context_length: 8192 } }] }] }
    : { data: [{ id: 'test-model', context_length: 131072 }, { id: 'other', context_length: 64000, top_provider: { context_length: 32000 } }] })) });
  const saved = service.save(profile({ keyAction: 'replace', key: 'private-fixture' }));
  assert.equal(service.contextCapacity(saved.id, 'test-model').limit, null);
  await service.request(saved.id, 'models');
  assert.equal(service.contextCapacity(saved.id, 'test-model').limit, 8192);
  assert.equal(service.contextCapacity(saved.id, 'test-model').source, 'loaded');
  assert.equal(service.contextCapacity(saved.id, 'other').limit, 32000);
  service.setContextLimit(saved.id, 'test-model', 16384);
  await service.request(saved.id, 'models');
  const reopened = new Connections({ file, protector });
  assert.deepEqual(reopened.snapshot().profiles[0].discoveredModels, ['other', 'test-model']);
  service.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(service.request(saved.id, 'models'), /HTTP 503/);
  assert.deepEqual(service.snapshot().profiles[0].discoveredModels, ['other', 'test-model']);
  assert.equal(reopened.contextCapacity(saved.id, 'test-model').limit, 16384);
  assert.equal(reopened.contextCapacity(saved.id, 'other').limit, 32000);
  assert.ok(!JSON.stringify(reopened.snapshot()).includes('private-fixture'));
  reopened.setContextLimit(saved.id, 'test-model', null);
  assert.equal(reopened.contextCapacity(saved.id, 'test-model').limit, 8192);
  for (const bad of [0, -1, 100.1, '8192', Infinity, 10000001]) assert.throws(() => reopened.setContextLimit(saved.id, 'test-model', bad), /whole token/);
  reopened.save(profile({ id: saved.id, name: 'Renamed' }));
  assert.equal(reopened.contextCapacity(saved.id, 'test-model').limit, 8192);
  assert.deepEqual(reopened.snapshot().profiles[0].discoveredModels, ['other', 'test-model']);
  reopened.save(profile({ id: saved.id, baseUrl: 'http://localhost:9999/v1', keyAction: 'remove' }));
  assert.equal(reopened.contextCapacity(saved.id, 'test-model').limit, null);
  assert.equal(reopened.snapshot().profiles[0].discoveredModels, null);
});

test('unsupported metadata leaves discovery usable and never substitutes a trained maximum for a loaded size', async t => {
  let fail = true;
  const { service } = fixture(t, { fetchImpl: async url => url.endsWith('/api/v1/models')
    ? fail ? new Response('', { status: 404 }) : Response.json({ models: [{ type: 'llm', key: 'test-model', max_context_length: 131072, loaded_instances: [] }] })
    : Response.json({ data: [{ id: 'test-model' }] }) });
  const saved = service.save(profile());
  assert.deepEqual((await service.request(saved.id, 'models')).models, ['test-model']);
  assert.equal(service.contextCapacity(saved.id, 'test-model').limit, null);
  fail = false; await service.request(saved.id, 'models');
  assert.equal(service.contextCapacity(saved.id, 'test-model').limit, null);
});

test('profiles and encrypted keys survive restart; snapshots exclude credentials; replace/remove/default/delete', t => {
  const { file, service } = fixture(t);
  const first = service.save(profile({ keyAction: 'replace', key: 'test-secret-one' }));
  assert.equal(first.profiles[0].keyStatus, 'saved');
  assert.equal(JSON.stringify(first).includes('test-secret'), false);
  assert.equal(fs.readFileSync(file(), 'utf8').includes('test-secret'), false);
  const reopened = new Connections({ file, protector });
  assert.equal(reopened.key(reopened.read().profiles[0]), 'test-secret-one');
  reopened.save(profile({ id: first.id, name: 'Renamed' }));
  assert.equal(reopened.key(reopened.read().profiles[0]), 'test-secret-one');
  reopened.save(profile({ id: first.id, keyAction: 'replace', key: 'test-secret-two' }));
  assert.equal(reopened.key(reopened.read().profiles[0]), 'test-secret-two');
  assert.throws(() => reopened.save(profile({ id: first.id, baseUrl: 'http://localhost:9999/v1' })), /address changed/);
  reopened.save(profile({ id: first.id, keyAction: 'remove' }));
  assert.equal(reopened.snapshot().profiles[0].keyStatus, 'none');
  const second = reopened.save(profile({ name: 'Second', makeDefault: true }));
  assert.equal(second.defaultId, second.id);
  assert.equal(reopened.remove(second.id).defaultId, first.id);
  assert.equal(reopened.remove(first.id).profiles.length, 0);
});

test('unprotected Linux uses memory only; locked encrypted keys never become ciphertext credentials', t => {
  const basic = protectedStorage({ ...safeStorage, getSelectedStorageBackend: () => 'basic_text' }, 'linux');
  const { file, service } = fixture(t, { protector: basic });
  service.save(profile({ keyAction: 'replace', key: 'session-secret' }));
  assert.equal(service.snapshot().profiles[0].keyStatus, 'session');
  assert.equal(fs.readFileSync(file(), 'utf8').includes('session-secret'), false);
  const reopened = new Connections({ file, protector: basic });
  assert.equal(reopened.snapshot().profiles[0].keyStatus, 'unavailable');
  assert.equal(reopened.key(reopened.read().profiles[0]), null);
  assert.equal(basic.decode({ enc: true, value: 'ciphertext' }), null);
});

test('save failure retains previous session key and corrupt configuration cannot be overwritten', t => {
  let fail = false;
  const { atomicJSON } = require('../protected-storage');
  const { file, service } = fixture(t, { protector: protectedStorage({ isEncryptionAvailable: () => false }),
    write: (file, data) => { if (fail) throw new Error('simulated disk error'); atomicJSON(file, data); } });
  const saved = service.save(profile({ keyAction: 'replace', key: 'original' }));
  fail = true;
  assert.throws(() => service.save(profile({ id: saved.id, keyAction: 'replace', key: 'replacement' })), /disk error/);
  assert.equal(service.key(service.read().profiles[0]), 'original');
  fs.writeFileSync(file(), '{invalid');
  assert.throws(() => service.save(profile()), /left unchanged/);
  assert.equal(fs.readFileSync(file(), 'utf8'), '{invalid');
});

test('legacy cover keys migrate out of plaintext; unavailable protection keeps them only in memory', t => {
  const { file } = fixture(t);
  fs.writeFileSync(file(), JSON.stringify({ openai: { enc: false, value: 'old-cover-key' } }));
  const store = legacySecretStore(file, protector);
  assert.equal(store.get('openai'), 'old-cover-key');
  assert.equal(fs.readFileSync(file(), 'utf8').includes('old-cover-key'), false);
  fs.writeFileSync(file(), JSON.stringify({ openai: { enc: false, value: 'session-cover-key' } }));
  const memory = legacySecretStore(file, protectedStorage({ isEncryptionAvailable: () => false }));
  assert.equal(memory.get('openai'), 'session-cover-key');
  assert.equal(fs.readFileSync(file(), 'utf8').includes('session-cover-key'), false);
  memory.set('openai', ''); assert.equal(memory.get('openai'), null);
});

test('addresses and OpenAI preset are validated', () => {
  for (const baseUrl of ['file:///etc/passwd', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=bad', 'localhost:1234'])
    assert.throws(() => validateProfile(profile({ baseUrl })));
  assert.equal(validateProfile(profile({ baseUrl: 'http://192.168.1.2:1234/v1/' })).baseUrl, 'http://192.168.1.2:1234/v1');
  assert.throws(() => validateProfile(profile({ provider: 'openai' })), /OpenAI preset/);
});

test('discovery and both API formats send only test data, keep keys main-side, reject HTTP errors safely', async t => {
  const calls = []; let status = 200; let response = { data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }] };
  const { service } = fixture(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(response), { status }); } });
  const saved = service.save(profile({ keyAction: 'replace', key: 'secret-for-tests' }));
  assert.deepEqual((await service.request(saved.id, 'models')).models, ['a', 'z']);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-for-tests');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, undefined);
  response = { choices: [{ message: { content: 'Connected' } }] };
  assert.equal((await service.request(saved.id, 'response')).text, 'Connected');
  const chat = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(chat.messages, [{ role: 'user', content: 'Reply with the single word Connected.' }]);
  service.save(profile({ id: saved.id, api: 'responses' }));
  response = { output: [{ content: [{ type: 'output_text', text: 'Connected' }] }] };
  assert.equal((await service.request(saved.id, 'response')).text, 'Connected');
  assert.equal(JSON.parse(calls.at(-1).options.body).store, false);
  assert.match(calls.at(-1).url, /\/responses$/);
  status = 401; response = { error: 'secret-for-tests' };
  await assert.rejects(service.request(saved.id, 'models'), error => /HTTP 401/.test(error.message) && !error.message.includes('secret-for-tests'));
});

test('requests time out and can be cancelled', async t => {
  const { service } = fixture(t, { fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const saved = service.save(profile());
  await assert.rejects(service.request(saved.id, 'models', undefined, 10), /timed out/);
  const controller = new AbortController();
  const request = service.request(saved.id, 'response', controller.signal);
  controller.abort(); await assert.rejects(request, /cancelled/);
});


test('response settings persist by model, validate before writing, and reset for a different endpoint', async t => {
  const calls = [];
  const { service, file } = fixture(t, { fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const saved = service.save(profile({ responseSettings: [{ model: 'test-model', maxReplyTokens: 1200, temperature: 0 }, { model: 'other', maxReplyTokens: 7000, temperature: null }] }));
  const reopened = new Connections({ file, protector });
  assert.equal(reopened.responseSettings(saved.id, 'test-model').temperature, 0);
  assert.equal(reopened.responseSettings(saved.id, 'other').maxReplyTokens, 7000);
  assert.equal(reopened.responseSettings(saved.id, 'unconfigured').maxReplyTokens, 4096);
  const before = fs.readFileSync(file(), 'utf8');
  for (const bad of [{ maxReplyTokens: 0, temperature: null }, { maxReplyTokens: 1.5, temperature: null }, { maxReplyTokens: 150000, temperature: null }, { maxReplyTokens: 1200, temperature: -1 }, { maxReplyTokens: 1200, temperature: 3 }]) {
    assert.throws(() => service.save(profile({ id: saved.id, responseSettings: [{ model: 'test-model', ...bad }] })));
    assert.equal(fs.readFileSync(file(), 'utf8'), before);
  }
  await service.generate({ profileId: saved.id, model: 'test-model', messages: [], onText: () => {} });
  assert.equal(calls.at(-1).max_tokens, 1200); assert.equal(calls.at(-1).temperature, 0);
  await service.generate({ profileId: saved.id, model: 'test-model', messages: [], onText: () => {}, kind: 'compact' });
  assert.equal(calls.at(-1).max_tokens, 4096); assert.equal('temperature' in calls.at(-1), false);
  service.save(profile({ id: saved.id, name: 'Renamed', responseSettings: [{ model: 'other', maxReplyTokens: 8000, temperature: 0.8 }] }));
  assert.equal(service.responseSettings(saved.id, 'test-model').maxReplyTokens, 1200);
  assert.equal(service.responseSettings(saved.id, 'other').maxReplyTokens, 8000);
  service.save(profile({ id: saved.id, baseUrl: 'http://localhost:5678/v1' }));
  assert.equal(service.responseSettings(saved.id, 'test-model').maxReplyTokens, 4096);
});
