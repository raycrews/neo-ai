(() => {
  const list = document.querySelector('#shortcut-list');
  const status = document.querySelector('#shortcut-status');
  let saving = false;
  function render(rows) {
    list.replaceChildren();
    for (const row of rows) {
      const line = document.createElement('div'); line.className = 'shortcut-setting';
      const label = document.createElement('label'); label.textContent = row.label;
      const input = document.createElement('input'); input.readOnly = true; input.value = row.accelerator; input.placeholder = 'Unassigned';
      input.id = 'shortcut-' + row.id; label.htmlFor = input.id; input.setAttribute('aria-description', 'Press a shortcut to assign it. Changes save immediately.');
      input.onkeydown = event => {
        if (event.key === 'Tab' || event.key === 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
        if (event.key === 'Backspace' || event.key === 'Delete') { save(row.id, ''); return; }
        let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        if (key === '+') key = 'Plus'; if (key === '-') key = 'Minus';
        const modifiers = [event.ctrlKey && 'Control', event.metaKey && 'Command', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
        save(row.id, [...modifiers, key].join('+'));
      };
      const clear = document.createElement('button'); clear.textContent = 'Clear'; clear.setAttribute('aria-label', 'Clear ' + row.label); clear.onclick = () => save(row.id, '');
      const reset = document.createElement('button'); reset.textContent = 'Default'; reset.setAttribute('aria-label', 'Restore default for ' + row.label); reset.onclick = () => save(row.id, null);
      line.append(label, input, clear, reset); list.append(line);
    }
  }
  async function save(id, accelerator) {
    if (saving) return; saving = true;
    list.querySelectorAll('input,button').forEach(el => el.disabled = true);
    try { render(await window.settingsAPI.saveShortcut({ id, accelerator })); status.textContent = 'Shortcut saved.'; document.getElementById('shortcut-' + id)?.focus(); }
    catch (error) { status.textContent = error.message; }
    finally { saving = false; list.querySelectorAll('input,button').forEach(el => el.disabled = false); }
  }
  document.querySelector('#shortcut-defaults').onclick = () => save(null, null);
  window.settingsAPI.shortcuts().then(render).catch(error => { status.textContent = error.message; });
})();
