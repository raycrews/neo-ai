const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');
const { prepareLibrary } = require('./library-location');

const DAILY = /^neo-backup-\d{4}-\d{2}-\d{2}\.zip$/;
const MANUAL = /^neo-manual-[\w-]+\.zip$/;
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_FILES = 50000;
const excluded = new Set(['backups', 'exports']);

function backupStatus(library) {
  const directory = path.join(library, 'Backups');
  let entries = [];
  try {
    entries = fs.readdirSync(directory).filter(name => DAILY.test(name) || MANUAL.test(name)).flatMap(name => {
      const stat = fs.lstatSync(path.join(directory, name));
      return stat.isFile() ? [{ name, date: stat.mtime.toISOString(), bytes: stat.size }] : [];
    }).sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { directory, latest: entries[0] || null, count: entries.length };
}

async function createBackup(library, { daily = false, now = new Date() } = {}) {
  prepareLibrary(library);
  const directory = path.join(library, 'Backups');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('The backup folder must be a regular folder.');
  const name = daily ? `neo-backup-${now.toISOString().slice(0, 10)}.zip`
    : `neo-manual-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.zip`;
  const target = path.join(directory, name);
  if (daily && fs.existsSync(target)) return backupStatus(library);
  const zip = new JSZip();
  let bytes = 0, count = 0;
  // Read one synchronous snapshot after the main process has flushed all editors.
  function walk(dir, relative = '') {
    for (const name of fs.readdirSync(dir)) {
      if (!relative && excluded.has(name.toLowerCase())) continue;
      const full = path.join(dir, name), rel = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Backups cannot include linked files or folders.');
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile()) {
        bytes += stat.size; count++;
        if (bytes > MAX_BYTES || count > MAX_FILES) throw new Error('This library exceeds the backup limit of 1 GB or 50,000 files.');
        zip.file(rel, fs.readFileSync(full), { date: stat.mtime });
      }
    }
  }
  walk(library);
  const temporary = target + '.tmp';
  try {
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) { /* No partial archive to keep. */ }
    throw error;
  }
  // Manual snapshots are kept until the author removes them.
  const old = fs.readdirSync(directory).filter(name => DAILY.test(name)).sort();
  while (old.length > 14) fs.unlinkSync(path.join(directory, old.shift()));
  return backupStatus(library);
}

function safeName(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /[\x00-\x1f:<>"|?*]/.test(name)) return false;
  return name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..'
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

async function readBackup(file) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_BYTES) throw new Error('Choose a backup ZIP smaller than 1 GB.');
  const archive = fs.readFileSync(file);
  let zip;
  try { zip = await JSZip.loadAsync(archive); }
  catch (_) { throw new Error('This ZIP could not be read. Choose a valid Neo-AI library backup.'); }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_FILES) throw new Error('This backup contains too many files.');
  const files = new Map(), seen = new Set();
  let bytes = 0;
  for (const entry of entries) {
    const name = entry.unsafeOriginalName || entry.name;
    if (!safeName(name) || name !== entry.name || ((entry.unixPermissions || 0) & 0xf000) === 0xa000)
      throw new Error('The backup contains an unsafe file path or linked file.');
    const key = name.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) throw new Error('The backup contains conflicting file names.');
    seen.add(key);
    if (excluded.has(name.split('/')[0].toLowerCase())) throw new Error('Choose a library backup without nested Backups or Exports folders.');
    if (entry.dir) continue;
    const chunks = [];
    // Bound actual inflated bytes, rather than trusting ZIP size metadata.
    await new Promise((resolve, reject) => {
      const stream = entry.nodeStream('nodebuffer');
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) stream.destroy(new Error('The expanded backup exceeds 1 GB.'));
        else chunks.push(chunk);
      });
      stream.on('error', reject); stream.on('end', resolve);
    });
    files.set(name, Buffer.concat(chunks));
  }
  // Verify checksums only after bounding expanded data, so malformed archives
  // cannot trigger an unbounded integrity-check decompression.
  try { await JSZip.loadAsync(archive, { checkCRC32: true }); }
  catch (_) { throw new Error('The backup is damaged (checksum mismatch). Choose another backup.'); }
  let catalog;
  try { catalog = JSON.parse(files.get('library.json').toString('utf8')); }
  catch (_) { throw new Error('The backup has no readable library.json catalog.'); }
  if (!Array.isArray(catalog.shelves) || catalog.shelves.some(s => !s || !Array.isArray(s.bookIds)))
    throw new Error('The backup library catalog is invalid.');
  const titles = [];
  for (const id of new Set(catalog.shelves.flatMap(s => s.bookIds))) {
    if (typeof id !== 'string' || !safeName(id) || id.includes('/')) throw new Error('The backup contains an invalid book ID.');
    try {
      const book = JSON.parse(files.get(`${id}/book.json`).toString('utf8'));
      if (!book || typeof book.title !== 'string') throw new Error();
      titles.push(book.title);
    } catch (_) { throw new Error(`The backup is missing readable book details for ${id}.`); }
  }
  // Reject file/directory collisions before creating anything on disk.
  const names = new Set([...files.keys()].map(n => n.toLowerCase()));
  for (const name of seen) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (names.has(parts.join('/'))) throw new Error('The backup contains conflicting file paths.'); parts.pop(); }
  }
  return { files, titles, bytes };
}

function restoreBackup(backup, parent) {
  if (!fs.statSync(parent).isDirectory()) throw new Error('Choose a folder for the recovered library.');
  // A new exclusive directory is the only extraction target; existing work is never overwritten.
  const destination = fs.mkdtempSync(path.join(parent, 'Neo-AI Recovered-'));
  try {
    for (const [name, data] of backup.files) {
      const target = path.join(destination, ...name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { flag: 'wx' });
    }
    prepareLibrary(destination);
  } catch (_) {
    throw new Error(`Restore could not finish. Your current library is intact. The incomplete copy is at ${destination}.`);
  }
  return destination;
}

module.exports = { backupStatus, createBackup, readBackup, restoreBackup };
