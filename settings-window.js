const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Connections } = require('./ai-connections');
const { AssistantPreferences } = require('./assistant-preferences');
const { InstructionLibrary, readInstructionText, validateEntry } = require('./instruction-library');
const fs = require('node:fs');

function installSettingsWindow({ app, BrowserWindow, ipcMain, dialog, protector, getLibraryPath, browseLibrary, appearance, backups }) {
  let window = null;
  const jobs = new Map();
  const assistants = new AssistantPreferences(() => path.join(app.getPath('userData'), 'ai-assistants.json'));
  const instructionLibrary = new InstructionLibrary(() => path.join(app.getPath('userData'), 'instruction-library.json'));
  const connections = new Connections({ file: () => path.join(app.getPath('userData'), 'ai-connections.json'), protector });
  const url = pathToFileURL(path.join(__dirname, 'settings.html')).href;
  function trusted(event) {
    return window && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === url;
  }
  function handle(name, fn) {
    ipcMain.handle(name, async (event, ...args) => {
      if (!trusted(event)) return { error: 'Settings request denied.' };
      try { return { value: await fn(event, ...args) }; }
      catch (error) { return { error: error.code ? 'Could not save settings. Check disk space and file permissions.' : error.message }; }
    });
  }
  handle('settings:read', () => ({ ...connections.snapshot(), version: app.getVersion(), libraryPath: getLibraryPath() }));
  handle('settings:browseLibrary', () => browseLibrary(window));
  handle('settings:backupStatus', () => backups.status());
  handle('settings:backupNow', () => backups.create());
  handle('settings:backupFolder', () => backups.showFolder());
  handle('settings:restoreBackup', () => backups.restore(window));
  handle('settings:openRestored', () => backups.openRestored());
  handle('settings:appearance', (_event, value) => appearance.save(value));
  const contextChanged = () => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('chat:contextChanged'); };
  handle('settings:save', (_event, data) => { const result = connections.save(data); contextChanged(); return result; });
  handle('settings:assistants', () => assistants.snapshot());
  handle('settings:instructionLibrary', () => instructionLibrary.read());
  handle('settings:saveInstruction', (_event, data) => instructionLibrary.save(data));
  handle('settings:deleteInstruction', (_event, id) => instructionLibrary.remove(id));
  handle('settings:importInstruction', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import instructions', properties: ['openFile'], filters: [{ name: 'Plain text', extensions: ['txt'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    const file = result.filePaths[0];
    return { name: path.basename(file, path.extname(file)).slice(0, 120), text: readInstructionText(file) };
  });
  handle('settings:exportInstruction', async (_event, data) => {
    validateEntry(data);
    let name = data.name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || 'Instructions';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'Instructions-' + name;
    const result = await dialog.showSaveDialog(window, { title: 'Export instructions', defaultPath: name + '.txt', filters: [{ name: 'Plain text', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return false;
    const temp = result.filePath + '.' + require('node:crypto').randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, data.text, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, result.filePath); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return true;
  });
  handle('settings:saveAssistant', (_event, data) => { const result = assistants.save(data); contextChanged(); return result; });
  handle('settings:remove', (_event, id) => { const result = connections.remove(id); contextChanged(); return result; });
  handle('settings:test', async (event, id, kind) => {
    if (jobs.has(event.sender.id)) throw new Error('A test is already running.');
    const controller = new AbortController();
    jobs.set(event.sender.id, controller);
    try { const result = await connections.request(id, kind, controller.signal); contextChanged(); return result; }
    finally { jobs.delete(event.sender.id); }
  });
  handle('settings:cancel', event => { jobs.get(event.sender.id)?.abort(); return true; });
  function open() {
    if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); return true; }
    window = new BrowserWindow({ width: 1080, height: 880, minWidth: 800, minHeight: 640,
      title: 'Settings — Neo-AI', backgroundColor: '#191919', show: !process.env.NEO_TEST_HEADLESS,
      webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const win = window;
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-prevent-unload', event => {
      const response = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0,
        message: 'Discard unsaved settings changes?' });
      if (response === 1) event.preventDefault();
    });
    const senderId = win.webContents.id;
    win.on('closed', () => { jobs.get(senderId)?.abort(); window = null; });
    win.loadFile(path.join(__dirname, 'settings.html'));
    return true;
  }
  ipcMain.handle('settings:open', event => {
    const file = pathToFileURL(path.join(__dirname, 'index.html')).href;
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== file) return false;
    return open();
  });
  return { open, connections, assistants };
}
module.exports = { installSettingsWindow };
