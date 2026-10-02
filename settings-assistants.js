(() => {
  let types = [], selected = 'general', saving = false;
  const picker = document.querySelector('#assistant-type');
  const editor = document.querySelector('#assistant-instructions');
  const status = document.querySelector('#assistant-status');
  const current = () => types.find(type => type.id === selected);
  const dirty = () => !!current() && editor.value !== current().instructions;
  window.assistantEditsPending = () => dirty() || saving;
  function controls() {
    document.querySelector('#assistant-fields').disabled = saving || !current();
    document.querySelector('#save-assistant').disabled = !dirty();
    document.querySelector('#revert-assistant').disabled = !dirty();
  }
  function render() { picker.value = selected; editor.value = current().instructions; controls(); }
  picker.onchange = () => {
    if (dirty() && !window.confirm('Discard unsaved assistant instructions?')) { picker.value = selected; return; }
    selected = picker.value; status.textContent = ''; render();
  };
  editor.oninput = () => { status.textContent = 'Unsaved changes'; controls(); };
  document.querySelector('#revert-assistant').onclick = () => { render(); status.textContent = ''; };
  document.querySelector('#restore-assistant').onclick = () => {
    editor.value = current().defaultInstructions; controls(); status.textContent = 'Default instructions restored in the editor. Save to apply.';
  };
  document.querySelector('#assistant-form').onsubmit = async event => {
    event.preventDefault(); if (saving || !dirty()) return;
    saving = true; controls(); status.textContent = 'Saving…';
    try {
      types = await window.settingsAPI.saveAssistant({ id: selected, instructions: editor.value });
      render(); status.textContent = 'Instructions saved. They will be used on the next message or revision.';
    } catch (error) { status.textContent = error.message; }
    finally { saving = false; controls(); }
  };
  window.addEventListener('beforeunload', event => { if (dirty() || saving) { event.preventDefault(); event.returnValue = false; } });
  window.settingsAPI.assistants().then(result => {
    types = result;
    picker.replaceChildren(...types.map(type => new Option(type.name, type.id))); render();
  }).catch(error => { status.textContent = error.message; });
})();
