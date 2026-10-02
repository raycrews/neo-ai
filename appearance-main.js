const path = require('node:path');
const { pathToFileURL } = require('node:url');
const defaults = { theme: 'dark', accent: '#c9a86a' };
function validateAppearance(value) {
  if (!value || !['dark', 'light', 'system'].includes(value.theme) || !/^#[0-9a-f]{6}$/i.test(value.accent || '')) {
    throw new Error('Choose a valid theme and accent color.');
  }
  return { theme: value.theme, accent: value.accent.toLowerCase() };
}
function installAppearance({ app, BrowserWindow, ipcMain, nativeTheme, readSettings, writeSettings }) {
  const pages = new Set(['index.html', 'settings.html', 'pane.html', 'ai-pane.html'].map(file => pathToFileURL(path.join(__dirname, file)).href));
  function preferences() {
    try { return validateAppearance(readSettings().appearance); } catch { return { ...defaults }; }
  }
  function snapshot() {
    const value = preferences();
    return { ...value, resolvedTheme: value.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : value.theme };
  }
  function broadcast() {
    const value = snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && pages.has(win.webContents.getURL())) {
        win.setBackgroundColor(value.resolvedTheme === 'light' ? '#f4f3ef' : '#191919');
        win.webContents.send('appearance:changed', value);
      }
    }
  }
  ipcMain.handle('appearance:read', event => {
    if (event.senderFrame !== event.sender.mainFrame || !pages.has(event.senderFrame.url)) return null;
    return snapshot();
  });
  nativeTheme.on('updated', broadcast);
  nativeTheme.themeSource = preferences().theme;
  return {
    snapshot,
    save(value) {
      const appearance = validateAppearance(value);
      writeSettings({ ...readSettings(true), appearance });
      nativeTheme.themeSource = appearance.theme;
      broadcast(); return snapshot();
    }
  };
}
module.exports = { installAppearance, validateAppearance, defaults };
