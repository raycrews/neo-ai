const $ = selector => document.querySelector(selector);
let state, selectedId = null, dirty = false, busy = false, keyAction = 'keep', emptyKeyAction = 'keep', loaded = false;
const discoveredModels = new Map();
let responseDrafts = new Map(), responseDraftScope = '', responseModel = '';
function responseScope() { return JSON.stringify([selectedId, $('#provider').value, $('#base-url').value.trim().replace(/\/+$/, ''), $('#api-format').value]); }
function renderResponseSettings() {
  const scope = responseScope();
  if (scope !== responseDraftScope) { responseDrafts.clear(); responseDraftScope = scope; }
  responseModel = $('#model').value.trim();
  const p = state.profiles.find(p => p.id === selectedId);
  const same = p && p.provider === $('#provider').value && p.baseUrl === $('#base-url').value.trim().replace(/\/+$/, '') && p.api === $('#api-format').value;
  const row = responseDrafts.get(responseModel) || (same && p.responseSettings?.find(row => row.model === responseModel));
  $('#reply-tokens').value = row?.maxReplyTokens ?? 4096;
  $('#response-temperature').value = row?.temperature ?? '';
  $('#response-model-label').textContent = responseModel ? 'For model: ' + responseModel : 'Choose or enter a model above.';
  $('#response-fields').disabled = !responseModel;
}
function rememberResponseSettings() {
  if (responseModel) responseDrafts.set(responseModel, { model: responseModel, maxReplyTokens: Number($('#reply-tokens').value), temperature: $('#response-temperature').value === '' ? null : Number($('#response-temperature').value) });
}
$('#reply-tokens').oninput = rememberResponseSettings;
$('#response-temperature').oninput = rememberResponseSettings;
$('#reset-response').onclick = () => { $('#reply-tokens').value = 4096; $('#response-temperature').value = ''; rememberResponseSettings(); changed(); };

function modelCacheKey() {
  return JSON.stringify([selectedId, $('#provider').value, $('#base-url').value.trim().replace(/\/+$/, ''), $('#api-format').value]);
}
function highlightModel() {
  const models = discoveredModels.get(modelCacheKey()) || [];
  $('#available-models').value = models.includes($('#model').value.trim()) ? $('#model').value.trim() : '';
}
function renderModels() {
  const models = discoveredModels.get(modelCacheKey());
  $('#model-browser').hidden = !models;
  $('#available-models').replaceChildren();
  if (!models) return;
  $('#model-count').textContent = `${models.length} model${models.length === 1 ? '' : 's'}`;
  $('#available-models').disabled = models.length === 0;
  $('#model-empty').hidden = models.length > 0;
  $('#model-empty').textContent = 'The server returned no models. Load a model in your server, then discover models again.';
  const placeholder = new Option(models.length ? 'Choose an available model…' : 'No models available', '');
  placeholder.disabled = true;
  $('#available-models').append(placeholder, ...models.map(id => new Option(id, id)));
  highlightModel();
}
function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
function controls() {
  $('#fields').disabled = busy || !loaded;
  $('#add-profile').disabled = busy || !loaded;
  $('#profiles').querySelectorAll('button').forEach(b => b.disabled = busy);
  $('#unsaved').hidden = !dirty;
  $('#delete-profile').hidden = !selectedId;
  $('#revert-profile').disabled = !dirty;
  $('#save-profile').disabled = busy || !loaded || (!dirty && !!selectedId);
  for (const id of ['discover', 'test-connection', 'test-response']) $( '#' + id).disabled = busy || dirty || !selectedId;
  $('#test-response').disabled ||= !$('#model').value.trim();
  $('#cancel-test').hidden = !busy;
  $('#api-format').disabled = busy || $('#provider').value === 'openai';
  $('#base-url').readOnly = $('#provider').value === 'openai';
}
function changed() { dirty = true; status(''); controls(); }
function canLeave() { return !dirty || window.confirm('Discard unsaved connection changes?'); }
function renderProfiles() {
  $('#profiles').replaceChildren();
  for (const p of state.profiles) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = p.id;
    b.setAttribute('aria-pressed', String(p.id === selectedId));
    b.append(document.createTextNode(p.name));
    const meta = document.createElement('small'); meta.textContent = state.presets[p.provider].name + (state.defaultId === p.id ? ' · Default' : ''); b.append(meta);
    b.onclick = () => { if (canLeave()) select(p.id); }; $('#profiles').append(b);
  }
}
function select(id) {
  const p = state.profiles.find(p => p.id === id);
  selectedId = p?.id || null;
  const preset = state.presets.lmstudio;
  $('#form-title').textContent = p ? 'Connection details' : 'New connection';
  $('#profile-name').value = p?.name || preset.name;
  $('#provider').value = p?.provider || 'lmstudio';
  $('#base-url').value = p?.baseUrl || preset.baseUrl;
  $('#api-format').value = p?.api || preset.api;
  $('#model').value = p?.model || '';
  renderModels(); responseDrafts.clear(); renderResponseSettings();
  $('#make-default').checked = !state.defaultId || state.defaultId === p?.id;
  $('#make-default').disabled = state.defaultId === p?.id;
  $('#api-key').value = ''; keyAction = emptyKeyAction = 'keep';
  $('#api-key').placeholder = p?.keyStatus === 'saved' || p?.keyStatus === 'session' ? 'Enter a replacement key' : 'Enter a key if required';
  $('#key-status').textContent = { saved: 'Key saved', session: 'Session only', unavailable: 'Key unavailable', none: 'No key' }[p?.keyStatus || 'none'];
  $('#remove-key').disabled = !p || p.keyStatus === 'none';
  $('#storage-note').textContent = state.secureStorage
    ? 'Keys are protected by your system key store and saved only on this computer.'
    : 'Protected storage is unavailable. Keys are kept in memory for this app session only; enter them again after restarting.';
  dirty = false; renderProfiles(); status(''); controls();
}
function payload() {
  return { id: selectedId, name: $('#profile-name').value, provider: $('#provider').value,
    baseUrl: $('#base-url').value, api: $('#api-format').value, model: $('#model').value,
    responseSettings: [...responseDrafts.values()],
    keyAction, key: keyAction === 'replace' ? $('#api-key').value : undefined, makeDefault: $('#make-default').checked };
}
$('#profile-form').addEventListener('input', changed);
$('#provider').onchange = () => {
  const preset = state.presets[$('#provider').value];
  $('#profile-name').value = preset.name; $('#base-url').value = preset.baseUrl;
  $('#api-format').value = preset.api; $('#model').value = ''; renderModels(); renderResponseSettings();
  $('#api-key').value = ''; keyAction = emptyKeyAction = 'remove'; $('#key-status').textContent = 'No key';
  changed();
};
$('#available-models').onchange = () => {
  const value = $('#available-models').value;
  if (value && $('#model').value !== value) { $('#model').value = value; renderResponseSettings(); changed(); }
};
$('#model').oninput = () => { highlightModel(); renderResponseSettings(); };
$('#base-url').oninput = () => { renderModels(); renderResponseSettings(); };
$('#api-format').onchange = () => { renderModels(); renderResponseSettings(); };
$('#api-key').oninput = () => {
  keyAction = $('#api-key').value ? 'replace' : emptyKeyAction;
  const p = state.profiles.find(p => p.id === selectedId);
  $('#key-status').textContent = keyAction === 'replace' ? 'Replace on save' : keyAction === 'remove' ? 'Removed on save' :
    ({ saved: 'Key saved', session: 'Session only', unavailable: 'Key unavailable', none: 'No key' }[p?.keyStatus || 'none']);
  $('#remove-key').disabled = false; changed();
};
$('#remove-key').onclick = () => { $('#api-key').value = ''; keyAction = emptyKeyAction = 'remove'; $('#key-status').textContent = 'Removed on save'; changed(); };
$('#add-profile').onclick = () => { if (canLeave()) { select(null); $('#profile-name').focus(); $('#profile-name').select(); } };
$('#revert-profile').onclick = () => select(selectedId);
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  busy = true; controls();
  try {
    const result = await window.settingsAPI.save(payload());
    if (keyAction !== 'keep') discoveredModels.delete(modelCacheKey());
    state = { ...state, ...result }; select(result.id); status('Connection saved.');
  }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
};
$('#delete-profile').onclick = async () => {
  if (!selectedId || !window.confirm('Delete this connection and its saved key?')) return;
  busy = true; controls();
  try { state = { ...state, ...await window.settingsAPI.remove(selectedId) }; select(state.defaultId); status('Connection deleted.'); }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
};
async function test(kind) {
  if (busy || dirty || !selectedId) return;
  busy = true; controls(); status(kind === 'response' ? 'Waiting for a response… Local models may need time to load.' : 'Connecting…');
  try {
    const result = await window.settingsAPI.test(selectedId, kind);
    if (result.models) {
      discoveredModels.set(modelCacheKey(), result.models);
      renderModels();
      status(`Connected in ${result.elapsedMs} ms. ${result.models.length} model${result.models.length === 1 ? '' : 's'} available.` +
        (result.models.length ? '\nChoose a model from the Available models drop-down, then Save connection.' : '\nLoad a model in your server, then discover models again.'));
      if (kind === 'models') {
        $('#model-browser').scrollIntoView({ block: 'center' });
      }
    } else status(`Response received in ${(result.elapsedMs / 1000).toFixed(1)} s:\n${result.text}`);
  } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
}
$('#discover').onclick = () => test('models');
$('#test-connection').onclick = () => test('connection');
$('#test-response').onclick = () => test('response');
$('#cancel-test').onclick = () => window.settingsAPI.cancel().catch(error => status(error.message, true));
for (const b of document.querySelectorAll('[data-page]')) b.onclick = () => {
  for (const other of document.querySelectorAll('[data-page]')) { const active = other === b; if (active) other.setAttribute('aria-current', 'page'); else other.removeAttribute('aria-current'); $('#' + other.dataset.page).hidden = !active; }
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = false; } });
window.settingsAPI.read().then(result => {
  state = result; loaded = true;
  $('#library-path').textContent = state.libraryPath; $('#app-version').textContent = 'Neo-AI ' + state.version;
  select(state.defaultId || state.profiles[0]?.id);
}).catch(error => { status(error.message, true); controls(); });
