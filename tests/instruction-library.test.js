const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InstructionLibrary, readInstructionText } = require('../instruction-library');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-instructions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'library.json');
  return { directory, file, library: new InstructionLibrary(() => file) };
}
test('instruction entries preserve long Unicode text, rename, reopen and delete', t => {
  const { file, library } = fixture(t);
  assert.deepEqual(library.read(), []);
  const text = '  Mystery — café\r\nKeep line breaks.\n'.repeat(1500);
  const first = library.save({ name: ' Mystery ', text });
  assert.equal(first.entries[0].name, 'Mystery');
  library.save({ id: first.id, name: 'New name', text });
  assert.equal(new InstructionLibrary(() => file).read()[0].text, text);
  assert.throws(() => library.save({ name: 'NEW NAME', text }), /already exists/);
  assert.deepEqual(library.remove(first.id), []);
  assert.throws(() => library.save({ id: first.id, name: 'Old entry', text }), /no longer exists/);
});
test('invalid input and failed writes leave saved instructions intact', t => {
  const { file, library } = fixture(t);
  const { id } = library.save({ name: 'Original', text: 'Keep this' });
  const before = fs.readFileSync(file, 'utf8');
  for (const value of [{ name: '', text: '' }, { name: 'Large', text: 'a'.repeat(200001) }, { name: 'Binary', text: '\0' }]) assert.throws(() => library.save(value));
  const failing = new InstructionLibrary(() => file, () => { throw new Error('Disk full'); });
  assert.throws(() => failing.save({ id, name: 'Changed', text: 'Lost?' }), /Disk full/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => library.save({ name: 'New', text: '' }), /left unchanged/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('text import accepts UTF-8 and rejects binary, invalid encoding and oversize input', t => {
  const { directory } = fixture(t); const file = path.join(directory, 'entry.txt');
  fs.writeFileSync(file, '\ufeffOne\r\nTwo — three');
  assert.equal(readInstructionText(file), 'One\r\nTwo — three');
  for (const data of [Buffer.from([255, 254, 12]), 'bad\0text', 'x'.repeat(200001), 'x'.repeat(800001)]) {
    fs.writeFileSync(file, data); assert.throws(() => readInstructionText(file));
  }
});
