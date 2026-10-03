const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('neoRevisionAPI', {
  connections: () => ipcRenderer.invoke('revision:connections'),
  generate: input => ipcRenderer.invoke('revision:generate', input),
  cancel: requestId => ipcRenderer.invoke('revision:cancel', requestId),
  onOpen: callback => ipcRenderer.on('revision:open', (_event, action) => callback(action))
});
contextBridge.exposeInMainWorld('neoAppearance', {
  read: () => ipcRenderer.invoke('appearance:read'),
  onChange: callback => ipcRenderer.on('appearance:changed', (_event, value) => callback(value))
});
contextBridge.exposeInMainWorld('neoChat', {
  read: id => ipcRenderer.invoke('chat:read', id),
  searchSnapshot: id => ipcRenderer.invoke('chat:searchSnapshot', id),
  reveal: (bookId, id, messageId) => ipcRenderer.invoke('chat:reveal', bookId, id, messageId),
  onReveal: callback => ipcRenderer.on('chat:reveal', (_event, value) => callback(value)),
  context: id => ipcRenderer.invoke('chat:context', id),
  budget: (bookId, id, draft, preview) => ipcRenderer.invoke('chat:budget', bookId, id, draft, preview),
  setContextLimit: (bookId, profileId, model, limit) => ipcRenderer.invoke('chat:limit', bookId, profileId, model, limit),
  action: (id, action) => ipcRenderer.invoke('chat:action', id, action),
  connections: id => ipcRenderer.invoke('chat:connections', id),
  models: (id, profileId) => ipcRenderer.invoke('chat:models', id, profileId),
  exportConversation: (id, conversationId) => ipcRenderer.invoke('chat:export', id, conversationId),
  flush: id => ipcRenderer.invoke('chat:flush', id),
  onContextChanged: callback => ipcRenderer.on('chat:contextChanged', () => callback()),
  onState: callback => ipcRenderer.on('chat:state', (_event, value) => callback(value))
});

contextBridge.exposeInMainWorld('neo', {
  shortcuts: () => ipcRenderer.invoke('shortcuts:read'),
  onShortcuts: callback => ipcRenderer.on('shortcuts:changed', (_event, rows) => callback(rows)),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  openPane: (kind) => ipcRenderer.invoke('panes:open', kind),
  flushPanes: () => ipcRenderer.invoke('panes:flush'),
  flushChatDrafts: () => ipcRenderer.invoke('panes:flushChatDrafts'),
  publishPaneState: (state) => ipcRenderer.send('panes:publish', state),
  replyPaneCommand: (reply) => ipcRenderer.send('panes:reply', reply),
  onPaneCommand: (callback) => ipcRenderer.on('panes:command', (_event, command) => callback(command)),
  onPaneState: (callback) => ipcRenderer.on('panes:state', (_event, state) => callback(state)),
  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  listBooks: () => ipcRenderer.invoke('library:listBooks'),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  writeChapter: (bookId, chId, html) => ipcRenderer.invoke('chapter:write', bookId, chId, html),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  libraryPath: () => ipcRenderer.invoke('library:path'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  setCover: (bookId, srcPath) => ipcRenderer.invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => ipcRenderer.invoke('cover:remove', bookId),
  readCover: (bookId, fname) => ipcRenderer.invoke('cover:read', bookId, fname),
  paintCover: (bookId, text, options) => ipcRenderer.invoke('cover:paint', bookId, text, options),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  hasSecret: (name) => ipcRenderer.invoke('secret:has', name),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),
  fullscreenToggle: () => ipcRenderer.invoke('fullscreen:toggle'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  spellCheckWords: (words) => ipcRenderer.invoke('spell:check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell:suggest', word),
  spellLearn: (word) => ipcRenderer.invoke('spell:learn', word),
  setSpellLanguage: (code) => ipcRenderer.invoke('spell:setLanguage', code),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openRelease: () => ipcRenderer.invoke('update:openRelease'),

  poetryState: (on) => ipcRenderer.send('poetry:state', on),
  typewriterState: (st) => ipcRenderer.send('typewriter:state', st),
  // interface language, fetched once before the page's scripts run
  i18n: ipcRenderer.sendSync('i18n:get'),
  reloadForLanguage: () => ipcRenderer.invoke('i18n:reload'),

  writingStyleState: (st) => ipcRenderer.send('style:state', st),
  menuState: value => ipcRenderer.send('menu:state', value),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});
