const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

// The installer requests a fresh profile; it never deletes writing or preferences.
function selectProfile(root, documents) {
  const pointer = path.join(root, 'profile-location.json');
  const request = path.join(root, 'fresh-setup-request');
  let saved;
  try { saved = JSON.parse(fs.readFileSync(pointer, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved && !/^[a-f0-9-]{36}$/.test(saved.id)) throw new Error('Invalid device profile location.');
  let requestId;
  try {
    requestId = createHash('sha256').update(fs.readFileSync(request)).update(String(fs.statSync(request).mtimeMs)).digest('hex');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (requestId && requestId !== saved?.requestId) {
    const id = randomUUID();
    const directory = path.join(root, 'profiles', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({
      libraryDir: path.join(documents, 'Neo-AI Library-' + id), initializeLibrary: true
    }, null, 2), { flag: 'wx' });
    saved = { version: 1, id, requestId };
    const temp = pointer + '.' + id + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(saved), { flag: 'wx' });
    fs.renameSync(temp, pointer);
  }
  if (requestId) { try { fs.unlinkSync(request); } catch { /* Already recorded; do not reset twice. */ } }
  return saved ? path.join(root, 'profiles', saved.id) : root;
}
module.exports = { selectProfile };
