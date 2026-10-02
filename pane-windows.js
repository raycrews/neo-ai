// Native pane windows share the workspace's editing session. A pane never
// writes book files independently; commands are acknowledged by the owner.
const path = require('node:path');

function restoredBounds(saved, displays) {
  const bounds = { width: 560, height: 740 };
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return bounds;
  const display = displays.find(({ workArea: a }) => Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
    saved.x < a.x + a.width && saved.x + saved.width > a.x &&
    saved.y < a.y + a.height && saved.y + saved.height > a.y);
  if (!display) return bounds;
  const a = display.workArea;
  bounds.width = Math.min(a.width, Math.max(380, saved.width));
  bounds.height = Math.min(a.height, Math.max(360, saved.height));
  bounds.x = Math.max(a.x, Math.min(saved.x, a.x + a.width - bounds.width));
  bounds.y = Math.max(a.y, Math.min(saved.y, a.y + a.height - bounds.height));
  return bounds;
}

function installPaneWindows({ BrowserWindow, ipcMain, screen, readSettings, writeSettings, dialog }) {
  let owner = null;
  let snapshot = null;
  let sequence = 0;
  let tail = Promise.resolve();
  const windows = new Map();
  const requests = new Map();
  const closing = new Set();
  const flushRequests = new Map();

  const isOwner = (event) => owner && !owner.isDestroyed() && event.sender === owner.webContents;
  const kindFor = (event) => [...windows].find(([, win]) => !win.isDestroyed() && win.webContents === event.sender)?.[0];
  const state = () => ({ snapshot, detached: [...windows.keys()] });
  function broadcast() {
    for (const win of [owner, ...windows.values()]) {
      if (win && !win.isDestroyed()) win.webContents.send('panes:state', state());
    }
  }
  function request(command) {
    return new Promise((resolve, reject) => {
      if (!owner || owner.isDestroyed()) return reject(new Error('The writing workspace is closed.'));
      const id = ++sequence;
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('The writing workspace did not respond. Your unsent text remains in this window.'));
      }, 15000);
      requests.set(id, { resolve, reject, timer });
      owner.webContents.send('panes:command', { id, command, expiresAt: Date.now() + 14000 });
    });
  }
  function enqueue(command) {
    const result = tail.then(() => request(command));
    tail = result.catch(() => {});
    return result;
  }
  function reset() {
    snapshot = null;
    for (const pending of requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The writing workspace was closed or reloaded.'));
    }
    requests.clear();
    broadcast();
  }
  ipcMain.on('panes:publish', (event, value) => {
    if (!isOwner(event)) return;
    snapshot = value;
    broadcast();
  });
  ipcMain.on('panes:reply', (event, { id, result, error }) => {
    if (!isOwner(event)) return;
    const pending = requests.get(id);
    if (!pending) return;
    requests.delete(id);
    clearTimeout(pending.timer);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  });
  ipcMain.handle('panes:state', (event) => {
    if (!isOwner(event) && !kindFor(event)) throw new Error('Unknown window');
    return state();
  });
  async function flushPanes(kind = null, draftsOnly = false) {
    const targets = kind ? [windows.get(kind)].filter(Boolean) : [...windows.values()];
    await Promise.all(targets.map((win) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { flushRequests.delete(id); reject(new Error('Finish the outline edits before changing books.')); }, 18000);
      flushRequests.set(id, { win, resolve, reject, timer });
      win.webContents.send('panes:flushRequested', draftsOnly ? { id, draftsOnly: true } : id);
    })));
    await tail;
    return true;
  }
  ipcMain.handle('panes:flush', (event) => {
    if (!isOwner(event)) throw new Error('Unknown workspace');
    return flushPanes();
  });
  ipcMain.handle('panes:flushChatDrafts', event => {
    if (!isOwner(event)) throw new Error('Unknown workspace');
    return flushPanes('ai-assistance', true);
  });
  ipcMain.on('panes:flushed', (event, { id, error }) => {
    const pending = flushRequests.get(id);
    if (!pending || pending.win.webContents !== event.sender) return;
    clearTimeout(pending.timer);
    flushRequests.delete(id);
    if (error) pending.reject(new Error(error)); else pending.resolve();
  });
  ipcMain.handle('panes:command', (event, command) => {
    if (kindFor(event) !== 'outline' || !command || ![
      'chapterNote', 'sectionNote', 'addChapter', 'addSection', 'navigate'
    ].includes(command.type)) throw new Error('Unsupported pane action');
    return enqueue(command);
  });
  ipcMain.handle('panes:open', async (event, kind) => {
    if (!isOwner(event) || !['outline', 'ai-assistance'].includes(kind)) throw new Error('Unsupported pane');
    if (!snapshot) throw new Error('Open a book first.');
    const existing = windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return true;
    }
    const bounds = restoredBounds(readSettings().paneWindows?.[kind], screen.getAllDisplays());
    const win = new BrowserWindow({
      ...bounds, minWidth: 380, minHeight: 360,
      title: (kind === 'outline' ? 'Outline' : 'AI Assistance') + ' — Neo-AI', backgroundColor: '#202020', show: false,
      webPreferences: { preload: path.join(__dirname, kind === 'outline' ? 'pane-preload.js' : 'ai-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    windows.set(kind, win);
    // These are independent top-level windows: movable across monitors on
    // Windows and macOS, and managed normally by the Linux window manager.
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    const remember = () => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const settings = readSettings();
      settings.paneWindows = { ...settings.paneWindows, [kind]: win.getNormalBounds() };
      writeSettings(settings);
    };
    win.on('resize', remember);
    win.on('move', remember);
    win.on('closed', () => { windows.delete(kind); closing.delete(win); broadcast(); });
    win.on('close', (e) => {
      if (closing.has(win)) { remember(); return; }
      e.preventDefault();
      win.webContents.send('panes:closeRequested');
    });
    win.once('ready-to-show', () => { if (!process.env.NEO_TEST_HEADLESS) win.show(); });
    await win.loadFile(path.join(__dirname, kind === 'outline' ? 'pane.html' : 'ai-pane.html'));
    broadcast();
    return true;
  });
  ipcMain.handle('panes:close', async (event, dock) => {
    const kind = kindFor(event);
    if (!kind) throw new Error('Unknown pane');
    const win = windows.get(kind);
    // The renderer flushes its edit queue before invoking this handler.
    await tail;
    if (dock) {
      await enqueue({ type: 'dock', kind });
      if (owner && !owner.isDestroyed() && !process.env.NEO_TEST_HEADLESS) { owner.show(); owner.focus(); }
    }
    if (!win.isDestroyed()) { closing.add(win); win.close(); }
    return true;
  });

  return {
    getOwner: () => owner,
    getSnapshot: () => snapshot,
    isOwner, kindFor,
    commandOwner: command => enqueue(command),
    // A read must also work while the mutation queue is flushing a chat send.
    // Otherwise that send and the window-close flush could wait on each other.
    readChatContext: bookId => request({ type: 'chatContext', bookId }),
    syncChatNavigation: command => request(command),
    send(channel, payload) {
      for (const win of [owner, ...windows.values()]) if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
    async flush() { await flushPanes(); await enqueue({ type: 'flush' }); },
    attach(win) {
      owner = win;
      win.webContents.on('did-start-loading', reset);
      win.on('closed', () => {
        reset();
        owner = null;
        for (const pane of windows.values()) pane.destroy();
        windows.clear();
      });
      let permitted = false;
      let preparing = false;
      win.on('close', async (event) => {
        if (permitted) return;
        event.preventDefault();
        if (preparing) return;
        preparing = true;
        try {
          // Each pane commits pending text first. Keep the owner alive until
          // all panes close, then wait for its final disk writes.
          for (const pane of [...windows.values()]) {
            const gone = new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Finish or resolve the outline edits before closing the workspace.')), 20000);
              pane.once('closed', () => { clearTimeout(timer); resolve(); });
            });
            pane.close();
            await gone;
          }
          await enqueue({ type: 'flush' });
          permitted = true;
          win.close();
        } catch (error) {
          await dialog.showMessageBox(win, { type: 'warning', message: 'Workspace kept open', detail: error.message });
        } finally { preparing = false; }
      });
    }
  };
}

module.exports = { installPaneWindows, restoredBounds };
