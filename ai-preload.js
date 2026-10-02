const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neoAppearance', {
  read: () => ipcRenderer.invoke('appearance:read'),
  onChange: callback => ipcRenderer.on('appearance:changed', (_event, value) => callback(value))
});
contextBridge.exposeInMainWorld('neoChat', {
  onReveal: callback => ipcRenderer.on('chat:reveal', (_event, value) => callback(value)),
  read: id => ipcRenderer.invoke('chat:read', id),
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
contextBridge.exposeInMainWorld('neoPane', {
  state: () => ipcRenderer.invoke('panes:state'),
  close: dock => ipcRenderer.invoke('panes:close', !!dock),
  onState: callback => ipcRenderer.on('panes:state', (_event, state) => callback(state)),
  onCloseRequested: callback => ipcRenderer.on('panes:closeRequested', () => callback()),
  onFlushRequested: callback => ipcRenderer.on('panes:flushRequested', (_event, id) => callback(id)),
  flushed: reply => ipcRenderer.send('panes:flushed', reply)
});
