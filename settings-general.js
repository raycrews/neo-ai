(() => {
  const theme = document.querySelector('#appearance-theme');
  const color = document.querySelector('#accent-color');
  const status = document.querySelector('#appearance-status');
  const swatches = document.querySelector('#accent-swatches');
  let value = { theme: 'dark', accent: '#c9a86a' }, saving = false, pending = null;
  function render(next) {
    value = { theme: next.theme, accent: next.accent };
    theme.value = value.theme; color.value = value.accent;
    document.querySelector('#accent-value').textContent = value.accent.toUpperCase();
    swatches.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === value.accent)));
  }
  async function save(next) {
    pending = next;
    if (saving) return;
    saving = true;
    while (pending) {
      const current = pending; pending = null; status.textContent = 'Saving…';
      try { const saved = await window.settingsAPI.saveAppearance(current); if (!pending) render(saved); status.textContent = 'Appearance saved.'; }
      catch (error) { status.textContent = error.message; if (!pending && window.neoAppearanceState) render(window.neoAppearanceState); }
    }
    saving = false;
  }
  theme.onchange = () => save({ theme: theme.value, accent: color.value });
  color.oninput = () => save({ theme: theme.value, accent: color.value });
  for (const [name, hex] of [['Gold', '#c9a86a'], ['Blue', '#639fe8'], ['Teal', '#4eb9a7'], ['Purple', '#aa86dd'], ['Rose', '#d8809a'], ['Orange', '#e2a064']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.color = hex;
    button.title = name; button.setAttribute('aria-label', name); button.style.setProperty('--swatch', hex);
    button.onclick = () => { color.value = hex; save({ theme: theme.value, accent: hex }); };
    swatches.append(button);
  }
  document.querySelector('#appearance-defaults').onclick = () => save({ theme: 'dark', accent: '#c9a86a' });
  window.addEventListener('neo-appearance', event => { if (!saving) render(event.detail); });
  if (window.neoAppearanceState) render(window.neoAppearanceState);
  else window.neoAppearance.read().then(render);
  const browse = document.querySelector('#browse-library');
  const libraryStatus = document.querySelector('#library-status');
  browse.onclick = async () => {
    if (dirty || busy || saving || window.assistantEditsPending?.()) {
      libraryStatus.textContent = 'Save or revert your pending settings changes before switching libraries.'; return;
    }
    browse.disabled = true; libraryStatus.textContent = '';
    try { const result = await window.settingsAPI.browseLibrary(); if (result?.unchanged) libraryStatus.textContent = 'This library is already open.'; }
    catch (error) { libraryStatus.textContent = error.message; }
    finally { browse.disabled = false; }
  };
})();
