const fs = require('node:fs');
const path = require('node:path');

// An unavailable or damaged library must never be mistaken for a new library.
function prepareLibrary(directory, { initialize = false, seed } = {}) {
  const file = path.join(directory, 'library.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' || !initialize) throw error;
    fs.mkdirSync(directory, { recursive: true });
    if (fs.readdirSync(directory).length) {
      throw new Error('This folder contains files but has no library.json. Choose the folder containing your library.json, or an empty folder for a new library.');
    }
    // Exclusive creation also protects a library that reconnects during startup.
    fs.writeFileSync(file, JSON.stringify(seed, null, 2), { flag: 'wx' });
    raw = fs.readFileSync(file, 'utf8');
  }
  const library = JSON.parse(raw);
  if (!library || !Array.isArray(library.shelves) ||
      library.shelves.some(shelf => !shelf || !Array.isArray(shelf.bookIds))) {
    throw new Error('The library catalog is invalid. Your existing files have not been changed.');
  }
  return file;
}

// Validate before changing the saved location. Never create a catalog here.
function validateLibraryTarget(directory) {
  if (!fs.statSync(directory).isDirectory()) throw new Error('Choose a folder for your library.');
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  const entries = fs.readdirSync(directory);
  if (!entries.length) return;
  if (!entries.includes('library.json')) throw new Error('Choose a folder containing library.json, or an empty folder for a new library.');
  prepareLibrary(directory);
}

module.exports = { prepareLibrary, validateLibraryTarget };
