const fs = require('node:fs');
const { atomicJSON } = require('./protected-storage');
const types = require('./assistant-types');
class AssistantPreferences {
  constructor(file, write = atomicJSON) { this.file = file; this.write = write; }
  read() {
    let data;
    try { data = JSON.parse(fs.readFileSync(this.file(), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Could not read assistant instructions. The file has been left unchanged.');
    }
    if (data?.version !== 1 || !data.instructions || typeof data.instructions !== 'object' || Array.isArray(data.instructions)) throw new Error('Unrecognized assistant instructions. The file has been left unchanged.');
    for (const [id, text] of Object.entries(data.instructions)) this.validate(id, text);
    return data.instructions;
  }
  validate(id, text) {
    if (!types.some(type => type.id === id)) throw new Error('Choose a valid assistant type.');
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('Enter instructions between 1 and 12,000 characters.');
  }
  snapshot() {
    const saved = this.read();
    return types.map(type => ({ ...type, defaultInstructions: type.instructions, instructions: saved[type.id] ?? type.instructions }));
  }
  instructions(id = 'general') {
    const type = this.snapshot().find(type => type.id === id);
    if (!type) throw new Error('Choose a valid assistant type.');
    return type.instructions;
  }
  save({ id, instructions } = {}) {
    this.validate(id, instructions);
    const saved = this.read(); saved[id] = instructions.trim();
    this.write(this.file(), { version: 1, instructions: saved });
    return this.snapshot();
  }
}
module.exports = { AssistantPreferences };
