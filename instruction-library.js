const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { atomicJSON } = require('./protected-storage');
const MAX_TEXT = 200000;

function validateEntry(entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > 120) throw new Error('Enter a name between 1 and 120 characters.');
  if (typeof entry.text !== 'string' || entry.text.length > MAX_TEXT || entry.text.includes('\0')) throw new Error('Instructions must be text, up to 200,000 characters.');
}
class InstructionLibrary {
  constructor(file, write = atomicJSON) { this.file = file; this.write = write; }
  read() {
    let data;
    try { data = JSON.parse(fs.readFileSync(this.file(), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('Could not read the instruction library. The saved file has been left unchanged.');
    }
    if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error('Unrecognized instruction library. The saved file has been left unchanged.');
    const ids = new Set();
    for (const entry of data.entries) {
      validateEntry(entry);
      if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new Error('Invalid instruction library. The saved file has been left unchanged.');
      ids.add(entry.id);
    }
    return data.entries;
  }
  save(value) {
    validateEntry(value);
    const entries = this.read();
    const previous = value.id ? entries.find(entry => entry.id === value.id) : null;
    if (value.id && !previous) throw new Error('This entry no longer exists. Reload the instruction library.');
    const name = value.name.trim();
    if (entries.some(entry => entry.id !== value.id && entry.name.toLowerCase() === name.toLowerCase())) throw new Error('An entry with this name already exists. Choose another name.');
    const entry = { id: previous?.id || randomUUID(), name, text: value.text };
    if (previous) entries[entries.indexOf(previous)] = entry; else entries.push(entry);
    this.write(this.file(), { version: 1, entries });
    return { entries, id: entry.id };
  }
  remove(id) {
    const entries = this.read();
    if (!entries.some(entry => entry.id === id)) throw new Error('This entry no longer exists.');
    const remaining = entries.filter(entry => entry.id !== id);
    this.write(this.file(), { version: 1, entries: remaining });
    return remaining;
  }
}
function readInstructionText(file) {
  if (fs.statSync(file).size > MAX_TEXT * 4) throw new Error('Choose a text file containing at most 200,000 characters.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); }
  catch { throw new Error('Choose a UTF-8 plain text file.'); }
  validateEntry({ name: 'Import', text });
  return text;
}
module.exports = { InstructionLibrary, readInstructionText, validateEntry };
