(() => {
  const theme = document.querySelector('#appearance-theme');
  const color = document.querySelector('#accent-color');
  const status = document.querySelector('#appearance-status');
  const swatches = document.querySelector('#accent-swatches');
  let backupBusy = false;
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
    if (dirty || busy || saving || backupBusy || window.assistantEditsPending?.() || window.instructionLibraryEditsPending?.()) {
      libraryStatus.textContent = 'Save or revert your pending settings changes before switching libraries.'; return;
    }
    browse.disabled = true; libraryStatus.textContent = '';
    try { const result = await window.settingsAPI.browseLibrary(); if (result?.unchanged) libraryStatus.textContent = 'This library is already open.'; }
    catch (error) { libraryStatus.textContent = error.message; }
    finally { browse.disabled = false; }
  };

  const backupStatus = document.querySelector('#backup-status');
  const backupButtons = [...document.querySelectorAll('#backups-card button')];
  const recoveredButton = document.querySelector('#backup-open-restored');
  async function refreshBackups() {
    try {
      const state = await window.settingsAPI.backupStatus();
      document.querySelector('#backup-path').textContent = state.directory;
      document.querySelector('#backup-latest').textContent = state.latest
        ? `Last successful backup: ${new Date(state.latest.date).toLocaleString()} (${state.count} saved)` : 'No backups yet.';
      if (state.lastError) backupStatus.textContent = state.lastError;
      if (state.restored) { recoveredButton.hidden = false; recoveredButton.title = state.restored; }
      if (state.working && !backupBusy) {
        backupStatus.textContent = 'Backup in progress…';
        setTimeout(refreshBackups, 2000);
      } else if (backupStatus.textContent === 'Backup in progress…') backupStatus.textContent = '';
    } catch (error) { backupStatus.textContent = error.message; }
  }
  async function backupAction(action, message) {
    if (backupBusy) return;
    backupBusy = true; backupButtons.forEach(button => button.disabled = true); browse.disabled = true;
    backupStatus.textContent = message;
    try {
      const result = await action();
      backupStatus.textContent = result?.canceled ? 'Restore canceled.' : result?.restored
        ? `Recovered library saved to ${result.restored}. Open it when you are ready; Neo-AI will save your current work and restart.`
        : message === 'Creating backup…' ? 'Backup saved.' : '';
    } catch (error) { backupStatus.textContent = error.message; }
    finally { backupBusy = false; backupButtons.forEach(button => button.disabled = false); browse.disabled = false; await refreshBackups(); }
  }
  document.querySelector('#backup-now').onclick = () => backupAction(() => window.settingsAPI.backupNow(), 'Creating backup…');
  document.querySelector('#backup-folder').onclick = () => backupAction(() => window.settingsAPI.backupFolder(), '');
  document.querySelector('#backup-restore').onclick = () => backupAction(() => window.settingsAPI.restoreBackup(), 'Reading backup…');
  recoveredButton.onclick = () => {
    if (dirty || busy || saving || window.assistantEditsPending?.() || window.instructionLibraryEditsPending?.()) {
      backupStatus.textContent = 'Save or revert your pending settings changes before opening the recovered library.'; return;
    }
    backupAction(() => window.settingsAPI.openRestored(), 'Saving your current work and opening the recovered library…');
  };
  document.querySelector('[data-page="general"]').addEventListener('click', refreshBackups);
  refreshBackups();
})();
