(() => {
  const el = id => document.getElementById('instruction-' + id);
  let entries = [], selected = null, baseline = { name: '', text: '' }, ready = false, working = false;
  const draft = () => ({ id: selected, name: el('name').value, text: el('text').value });
  const changed = () => draft().name !== baseline.name || draft().text !== baseline.text;
  window.instructionLibraryEditsPending = () => working || changed();
  const status = (message, error = false) => { el('status').textContent = message; el('status').classList.toggle('error', error); };
  function controls() {
    el('fields').disabled = !ready || working;
    for (const id of ['new', 'import']) el(id).disabled = !ready || working;
    el('list').querySelectorAll('button').forEach(button => button.disabled = working);
    el('save').disabled = !changed() || !el('name').value.trim();
    el('revert').disabled = !changed();
    el('delete').disabled = !selected;
    el('copy').disabled = !el('text').value;
    el('export').disabled = !el('name').value.trim();
    el('duplicate').disabled = !el('name').value.trim();
    el('unsaved').hidden = !changed();
    el('count').textContent = el('text').value.length.toLocaleString() + ' / 200,000 characters';
  }
  function select(entry, saved = true) {
    selected = saved ? entry?.id || null : null;
    baseline = saved && entry ? { name: entry.name, text: entry.text } : { name: '', text: '' };
    el('name').value = entry?.name || ''; el('text').value = entry?.text || '';
    renderList(); status(''); controls();
  }
  function canLeave() { return !working && (!changed() || window.confirm('Discard unsaved instruction library changes?')); }
  function renderList() {
    el('list').replaceChildren(); el('empty').hidden = entries.length > 0;
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = entry.name;
      button.setAttribute('aria-pressed', String(entry.id === selected));
      button.onclick = () => { if (entry.id !== selected && canLeave()) select(entry); };
      el('list').append(button);
    }
  }
  function uniqueName(name) {
    let candidate = name.slice(0, 120), number = 2;
    while (entries.some(entry => entry.name.toLowerCase() === candidate.toLowerCase())) {
      const suffix = ' (' + number++ + ')'; candidate = name.slice(0, 120 - suffix.length) + suffix;
    }
    return candidate;
  }
  async function run(action) {
    if (working) return;
    working = true; controls(); status('');
    try { await action(); } catch (error) { status(error.message, true); }
    finally { working = false; controls(); }
  }
  for (const button of document.querySelectorAll('[data-ai-view]')) button.onclick = () => {
    for (const other of document.querySelectorAll('[data-ai-view]')) {
      const active = other === button; other.setAttribute('aria-pressed', String(active)); document.getElementById(other.dataset.aiView).hidden = !active;
    }
  };
  el('form').addEventListener('input', () => { status(''); controls(); });
  el('form').onsubmit = event => {
    event.preventDefault(); const value = draft();
    run(async () => { const result = await window.settingsAPI.saveInstruction(value); entries = result.entries; select(entries.find(entry => entry.id === result.id)); status('Entry saved.'); });
  };
  el('new').onclick = () => { if (canLeave()) { select(null); el('name').focus(); } };
  el('rename').onclick = () => { el('name').focus(); el('name').select(); };
  el('revert').onclick = () => select(entries.find(entry => entry.id === selected));
  el('duplicate').onclick = () => {
    const value = draft();
    if (canLeave()) { select({ name: uniqueName(value.name.trim().slice(0, 112) + ' — Copy'), text: value.text }, false); el('name').focus(); status('Copy ready. Save entry to keep it.'); }
  };
  el('delete').onclick = () => {
    if (!selected || !window.confirm('Delete this saved instruction entry' + (changed() ? ' and discard its unsaved changes' : '') + '?')) return;
    const id = selected;
    run(async () => { entries = await window.settingsAPI.deleteInstruction(id); select(entries[0]); status('Entry deleted.'); });
  };
  el('copy').onclick = () => run(async () => { await window.settingsAPI.copyInstruction(el('text').value); status('Instructions copied.'); });
  el('import').onclick = () => {
    if (!canLeave()) return;
    run(async () => { const value = await window.settingsAPI.importInstruction(); if (value) { select({ ...value, name: uniqueName(value.name) }, false); status('Text imported. Save entry to keep it.'); } });
  };
  el('export').onclick = () => { const value = draft(); run(async () => { if (await window.settingsAPI.exportInstruction(value)) status('Text file exported.'); }); };
  window.addEventListener('beforeunload', event => { if (working || changed()) { event.preventDefault(); event.returnValue = false; } });
  window.settingsAPI.instructionLibrary().then(result => { entries = result; ready = true; select(entries[0]); }).catch(error => { status(error.message, true); controls(); });
})();
