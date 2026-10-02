// Main process only. Plaintext credentials never cross back into a renderer.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readJSONStrict(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Could not read saved connection settings. The file has been left unchanged.'); }
}
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function protectedStorage(safeStorage, platform = process.platform) {
  function available() {
    try {
      return safeStorage.isEncryptionAvailable() &&
        (platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
    } catch { return false; }
  }
  return {
    available,
    encode(value) {
      if (!available()) return { session: true };
      try { return { enc: true, value: safeStorage.encryptString(value).toString('base64') }; }
      catch { throw new Error('The system key store is locked or unavailable. Unlock it and try saving again.'); }
    },
    decode(record) {
      if (!record?.enc || !available()) return null;
      try { return safeStorage.decryptString(Buffer.from(record.value, 'base64')); }
      catch { return null; }
    }
  };
}

// Also upgrades the original cover-art key store, which once allowed plaintext.
function legacySecretStore(file, protector) {
  const sessions = new Map();
  function migrate() {
    const all = readJSONStrict(file(), {});
    let changed = false;
    const pending = [];
    for (const [name, record] of Object.entries(all)) {
      if (record && record.enc === false && typeof record.value === 'string') {
        all[name] = protector.encode(record.value);
        if (all[name].session) pending.push([name, record.value]);
        changed = true;
      }
    }
    if (changed) { atomicJSON(file(), all); for (const [name, value] of pending) sessions.set(name, value); }
    return all;
  }
  return {
    get(name) { const all = migrate(); return sessions.get(name) || protector.decode(all[name]); },
    set(name, value) {
      if (name !== 'openai') throw new Error('Unknown cover provider.');
      const all = migrate();
      const record = value ? protector.encode(String(value)) : null;
      if (record) all[name] = record; else delete all[name];
      atomicJSON(file(), all);
      if (record?.session) sessions.set(name, String(value)); else sessions.delete(name);
      return true;
    }
  };
}
module.exports = { atomicJSON, readJSONStrict, protectedStorage, legacySecretStore };
