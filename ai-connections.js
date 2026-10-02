const { validateResponseSettings, responseSettings } = require('./response-settings');
// Device-local connection profiles and provider calls. No book access here.
const { randomUUID } = require('node:crypto');
const { atomicJSON, readJSONStrict } = require('./protected-storage');
const { validLimit, reportedModels, loadedModels } = require('./model-context');
const PRESETS = {
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', api: 'chat' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', api: 'chat' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'responses' },
  compatible: { name: 'Compatible server', baseUrl: '', api: 'chat' }
};
function validateProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('Enter connection details.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 100) throw new Error('Enter a connection name (up to 100 characters).');
  let url;
  try { url = new URL(String(input.baseUrl || '').trim()); } catch { throw new Error('Enter a full server address, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP or HTTPS base URL without a password, query, or fragment.');
  if (!Object.hasOwn(PRESETS, input.provider)) throw new Error('Choose a connection type.');
  if (!['chat', 'responses'].includes(input.api)) throw new Error('Choose an API format.');
  if (input.provider === 'openai' && (url.origin !== 'https://api.openai.com' || url.pathname.replace(/\/+$/, '') !== '/v1'))
    throw new Error('The OpenAI preset uses https://api.openai.com/v1. Choose Compatible server for another address.');
  const model = String(input.model || '').trim();
  if (model.length > 200) throw new Error('The model name is too long.');
  return { name, provider: input.provider, baseUrl: url.href.replace(/\/+$/, ''), api: input.provider === 'openai' ? 'responses' : input.api, model };
}

class Connections {
  constructor({ file, protector, fetchImpl = fetch, write = atomicJSON }) {
    this.file = file; this.protector = protector; this.fetch = fetchImpl; this.write = write;
    this.sessions = new Map();
  }
  read() {
    const state = readJSONStrict(this.file(), { version: 1, defaultId: null, profiles: [] });
    if (state.version !== 1 || !Array.isArray(state.profiles)) throw new Error('Unrecognized connection settings. The file has been left unchanged.');
    return state;
  }
  key(profile) { return this.sessions.get(profile.id) || this.protector.decode(profile.credential); }
  snapshot() {
    const state = this.read();
    return {
      defaultId: state.defaultId, secureStorage: this.protector.available(), presets: PRESETS,
      profiles: state.profiles.map(p => ({
        id: p.id, name: p.name, provider: p.provider, baseUrl: p.baseUrl, api: p.api, model: p.model,
        contextLimits: p.contextLimits || [], modelContexts: p.modelContexts || [],
        discoveredModels: p.discoveredModels || null, responseSettings: p.responseSettings || [],
        keyStatus: this.sessions.has(p.id) ? 'session' : !p.credential ? 'none' : this.key(p) ? 'saved' : 'unavailable'
      }))
    };
  }
  save(input) {
    const profile = validateProfile(input);
    const state = this.read();
    const previous = input.id ? state.profiles.find(p => p.id === input.id) : null;
    if (input.id && !previous) throw new Error('This connection no longer exists. Reopen Settings.');
    const id = previous?.id || randomUUID();
    const action = input.keyAction || 'keep';
    if (!['keep', 'replace', 'remove'].includes(action)) throw new Error('Invalid key action.');
    if (previous?.credential && previous.baseUrl !== profile.baseUrl && action === 'keep')
      throw new Error('The server address changed. Replace or remove the key before saving it for this address.');
    let credential = previous?.credential;
    let newKey;
    if (action === 'replace') {
      newKey = String(input.key || '').trim();
      if (!newKey || newKey.length > 8192 || /[\r\n]/.test(newKey)) throw new Error('Enter a valid API key or token.');
      credential = this.protector.encode(newKey);
    } else if (action === 'remove') credential = undefined;
    const next = { id, ...profile, ...(credential ? { credential } : {}) };
    if (previous && previous.baseUrl === profile.baseUrl && previous.api === profile.api && previous.provider === profile.provider) {
      next.contextLimits = previous.contextLimits || []; next.modelContexts = previous.modelContexts || [];
      next.discoveredModels = previous.discoveredModels || null;
      next.responseSettings = previous.responseSettings || [];
    }
    if (input.responseSettings !== undefined) {
      if (!Array.isArray(input.responseSettings) || input.responseSettings.length > 200) throw new Error('A connection can save response settings for up to 200 models.');
      const rows = new Map((next.responseSettings || []).map(row => [row.model, row]));
      for (const value of input.responseSettings) { const row = validateResponseSettings(value); rows.set(row.model, row); }
      if (rows.size > 200) throw new Error('A connection can save response settings for up to 200 models.');
      next.responseSettings = [...rows.values()];
    }
    state.profiles = previous ? state.profiles.map(p => p.id === id ? next : p) : [...state.profiles, next];
    if (!state.defaultId || input.makeDefault) state.defaultId = id;
    this.write(this.file(), state);
    if (action === 'remove' || (action === 'replace' && !credential.session)) this.sessions.delete(id);
    if (action === 'replace' && credential.session) this.sessions.set(id, newKey);
    return { id, ...this.snapshot() };
  }
  remove(id) {
    const state = this.read();
    state.profiles = state.profiles.filter(p => p.id !== id);
    if (state.defaultId === id) state.defaultId = state.profiles[0]?.id || null;
    this.write(this.file(), state); this.sessions.delete(id);
    return this.snapshot();
  }
  responseSettings(id, model) {
    return responseSettings(this.read().profiles.find(p => p.id === id), model);
  }
  contextCapacity(id, model) {
    const p = this.read().profiles.find(p => p.id === id);
    const manual = p?.contextLimits?.find(row => row.model === model);
    const reported = p?.modelContexts?.find(row => row.model === model);
    if (manual && validLimit(manual.limit)) return { limit: manual.limit, source: 'manual' };
    if (reported && validLimit(reported.limit)) return { limit: reported.limit, source: reported.source, checkedAt: reported.checkedAt };
    return { limit: null, source: 'unknown' };
  }
  setContextLimit(id, model, limit) {
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose a model first.');
    if (limit !== null && !validLimit(limit)) throw new Error('Enter a whole token limit from 512 to 10,000,000, or leave it blank to use discovery.');
    const state = this.read(), p = state.profiles.find(p => p.id === id);
    if (!p) throw new Error('Choose a saved connection.');
    const rows = (p.contextLimits || []).filter(row => row.model !== model);
    if (limit !== null) rows.push({ model, limit });
    if (rows.length > 200) throw new Error('This connection already has 200 model limits.');
    p.contextLimits = rows; this.write(this.file(), state);
    return this.snapshot();
  }
  async loadedContexts(p, key, signal) {
    // Optional LM Studio metadata. Unsupported versions keep manual limits available.
    if (p.provider !== 'lmstudio') return [];
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 3000);
    try {
      const url = p.baseUrl.replace(/\/v1$/, '') + '/api/v1/models';
      const res = await this.fetch(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) } });
      if (!res.ok) { await res.body?.cancel(); return []; }
      const reader = res.body.getReader(), chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); return []; } chunks.push(Buffer.from(value)); }
      return loadedModels(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return []; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async generate({ profileId, model, messages, signal, onText, kind = 'send' }) {
    const p = this.read().profiles.find(profile => profile.id === profileId);
    if (!p) throw new Error('Choose a saved connection in Settings.');
    validateProfile(p);
    const key = this.key(p);
    if (p.credential && !key) throw new Error('The saved key is unavailable. Unlock the system key store or enter it again in Settings.');
    if (p.provider === 'openai' && !key) throw new Error('Add an OpenAI API key in Settings first.');
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose or enter a model.');
    return require('./ai-stream').generateText({ fetchImpl: this.fetch, profile: p, key, model, messages, signal, onText, settings: responseSettings(kind === 'compact' ? null : p, model) });
  }
  async request(id, kind, signal, timeoutMs) {
    const p = this.read().profiles.find(p => p.id === id);
    if (!p) throw new Error('Save the connection first.');
    validateProfile(p);
    if (!['models', 'connection', 'response'].includes(kind)) throw new Error('Unknown connection test.');
    const key = this.key(p);
    if (p.credential && !key) throw new Error('The saved key is unavailable. Unlock the system key store or enter the key again.');
    if (p.provider === 'openai' && !key) throw new Error('Add an OpenAI API key first.');
    const responseTest = kind === 'response';
    if (responseTest && !p.model) throw new Error('Choose or enter a model, then save the connection.');
    const route = responseTest ? (p.api === 'responses' ? '/responses' : '/chat/completions') : '/models';
    const prompt = 'Reply with the single word Connected.';
    const body = !responseTest ? undefined : p.api === 'responses'
      ? { model: p.model, input: prompt, max_output_tokens: 512, store: false }
      : { model: p.model, messages: [{ role: 'user', content: prompt }], max_tokens: 128, stream: false };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs || (responseTest ? 120000 : 15000));
    const start = Date.now();
    try {
      const res = await this.fetch(p.baseUrl + route, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!res.ok) {
        await res.body?.cancel();
        const hint = { 401: 'The server rejected the key. Replace it and try again.', 403: 'This key does not have access.', 404: 'Endpoint or model not found. Check the base URL, API format, and model.', 429: 'The provider reported a rate or usage limit. Check your account and try later.' }[res.status];
        throw new Error(`HTTP ${res.status}. ${hint || 'The server could not complete this test. Check its configuration and selected model.'}`);
      }
      // Limit responses from custom endpoints; never display raw server errors.
      const reader = res.body.getReader(); let size = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('The server response was too large.'); } chunks.push(Buffer.from(value)); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The server did not return JSON. Check the base URL (usually ending in /v1).'); }
      const elapsedMs = Date.now() - start;
      if (!responseTest) {
        if (!Array.isArray(data.data)) throw new Error('The server did not return a compatible model list. You can enter a model name manually and use Test response.');
        const models = [...new Set(data.data.map(m => m?.id).filter(m => typeof m === 'string' && m.length <= 200))].sort();
        const reported = reportedModels(data);
        const loaded = await this.loadedContexts(p, key, controller.signal);
        if (controller.signal.aborted) throw new Error('Test cancelled.');
        const modelContexts = [...new Map([...reported, ...loaded].map(row => [row.model, { ...row, checkedAt: new Date().toISOString() }])).values()];
        // Re-read after the network call; never overwrite concurrent profile/key edits.
        const latest = this.read(), current = latest.profiles.find(row => row.id === p.id);
        if (current && current.baseUrl === p.baseUrl && current.api === p.api && current.provider === p.provider) {
          current.modelContexts = modelContexts; current.discoveredModels = models; this.write(this.file(), latest);
        }
        return { models, modelContexts, elapsedMs };
      }
      const text = p.api === 'responses'
        ? (data.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n')
        : data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('The server answered but returned no text. Check that this model supports text responses; reasoning models may need a larger output allowance.');
      return { text: (key ? text.split(key).join('[redacted]') : text).slice(0, 2000), elapsedMs };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(timedOut ? 'The request timed out. Check that the server is running and the model is loaded.' : 'Test cancelled.');
      if (error instanceof TypeError) throw new Error('Could not reach the server. Check the address, server status, and TLS certificate. Redirects are not followed.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
module.exports = { Connections, PRESETS, validateProfile };
