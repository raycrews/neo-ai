const { contextBridge, ipcRenderer } = require('electron');
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
contextBridge.exposeInMainWorld('neoPane', {
  state: () => ipcRenderer.invoke('panes:state'),
  command: (command) => ipcRenderer.invoke('panes:command', command),
  close: (dock) => ipcRenderer.invoke('panes:close', !!dock),
  onState: (callback) => ipcRenderer.on('panes:state', (_event, state) => callback(state)),
  onCloseRequested: (callback) => ipcRenderer.on('panes:closeRequested', () => callback()),
  onFlushRequested: (callback) => ipcRenderer.on('panes:flushRequested', (_event, id) => callback(id)),
  flushed: (reply) => ipcRenderer.send('panes:flushed', reply)
});
