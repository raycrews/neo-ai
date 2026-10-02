const fs = require('node:fs');
const path = require('node:path');
const { backupStatus, createBackup, readBackup, restoreBackup } = require('./library-backups');

function backupControls({ dialog, shell, getLibraryPath, flush, openLibrary }) {
  let working = false, restored = null, lastError = '';
  async function exclusive(action) {
    if (working) throw new Error('A library backup or restore is already in progress.');
    working = true;
    try { const value = await action(); lastError = ''; return value; }
    catch (error) { lastError = error.code ? 'Could not access backup files. Check the folder connection, free space and permissions.' : error.message; throw new Error(lastError); }
    finally { working = false; }
  }
  return {
    status() { return { ...backupStatus(getLibraryPath()), working, lastError, restored }; },
    daily() { return exclusive(() => createBackup(getLibraryPath(), { daily: true })); },
    create() { return exclusive(async () => { await flush(); return createBackup(getLibraryPath()); }); },
    async showFolder() {
      const directory = path.join(getLibraryPath(), 'Backups');
      fs.mkdirSync(directory, { recursive: true });
      const error = await shell.openPath(directory);
      if (error) throw new Error('Could not open the backup folder. ' + error);
    },
    restore(win) { return exclusive(async () => {
      const choice = await dialog.showOpenDialog(win, { title: 'Choose a library backup', defaultPath: path.join(getLibraryPath(), 'Backups'), filters: [{ name: 'Library backup', extensions: ['zip'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
      const backup = await readBackup(choice.filePaths[0]);
      const preview = await dialog.showMessageBox(win, { type: 'question', title: 'Restore library backup', message: `Restore a copy of this library?`,
        detail: `${path.basename(choice.filePaths[0])}\n\n${backup.titles.length} books · ${backup.files.size} files\n${backup.titles.slice(0, 10).join('\n')}${backup.titles.length > 10 ? '\n…' : ''}\n\nChoose a location next. A new recovered library folder will be created there. Your current library stays intact.`,
        buttons: ['Cancel', 'Choose location…'], defaultId: 0, cancelId: 0 });
      if (preview.response !== 1) return { canceled: true };
      const target = await dialog.showOpenDialog(win, { title: 'Choose where to create the recovered library', properties: ['openDirectory', 'createDirectory'] });
      if (target.canceled || !target.filePaths[0]) return { canceled: true };
      const parent = fs.realpathSync(target.filePaths[0]), current = fs.realpathSync(getLibraryPath());
      const rel = path.relative(current, parent);
      if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)))
        throw new Error('Choose a location outside the current library.');
      restored = restoreBackup(backup, parent);
      return { restored };
    }); },
    openRestored() { return exclusive(async () => {
      if (!restored) throw new Error('Restore a library backup first.');
      await openLibrary(restored);
    }); }
  };
}
module.exports = { backupControls };
