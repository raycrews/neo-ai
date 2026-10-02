const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neoAppearance', {
  read: () => ipcRenderer.invoke('appearance:read'),
  onChange: callback => ipcRenderer.on('appearance:changed', (_event, value) => callback(value))
});
const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result.error) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('settingsAPI', {
  read: () => call('settings:read'),
  browseLibrary: () => call('settings:browseLibrary'),
  saveAppearance: value => call('settings:appearance', value),
  assistants: () => call('settings:assistants'),
  saveAssistant: data => call('settings:saveAssistant', data),
  save: data => call('settings:save', data),
  remove: id => call('settings:remove', id),
  test: (id, kind) => call('settings:test', id, kind),
  cancel: () => call('settings:cancel')
});
