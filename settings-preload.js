const { contextBridge, ipcRenderer } = require('electron');
window.addEventListener('focusin', event => ipcRenderer.send('settings:captureShortcut', event.target.matches?.('#shortcut-list input') === true));
window.addEventListener('focusout', () => ipcRenderer.send('settings:captureShortcut', false));
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
  onNavigate: callback => ipcRenderer.on('settings:navigate', (_event, page) => callback(page)),
  read: () => call('settings:read'),
  shortcuts: () => call('settings:shortcuts'),
  saveShortcut: data => call('settings:saveShortcut', data),
  backupStatus: () => call('settings:backupStatus'),
  backupNow: () => call('settings:backupNow'),
  backupFolder: () => call('settings:backupFolder'),
  restoreBackup: () => call('settings:restoreBackup'),
  openRestored: () => call('settings:openRestored'),
  browseLibrary: () => call('settings:browseLibrary'),
  saveAppearance: value => call('settings:appearance', value),
  assistants: () => call('settings:assistants'),
  instructionLibrary: () => call('settings:instructionLibrary'),
  copyInstruction: text => call('settings:copyInstruction', text),
  saveInstruction: data => call('settings:saveInstruction', data),
  deleteInstruction: id => call('settings:deleteInstruction', id),
  importInstruction: () => call('settings:importInstruction'),
  exportInstruction: data => call('settings:exportInstruction', data),
  saveAssistant: data => call('settings:saveAssistant', data),
  save: data => call('settings:save', data),
  remove: id => call('settings:remove', id),
  test: (id, kind) => call('settings:test', id, kind),
  cancel: () => call('settings:cancel')
});
