const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareLibrary, validateLibraryTarget } = require('../library-location');
const seed = { firstRunDone: false, shelves: [{ bookIds: [] }] };

test('folder validation accepts empty and existing libraries without writing', t => {
  const dir = fixture(t);
  validateLibraryTarget(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(seed));
  validateLibraryTarget(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'), JSON.stringify(seed));
});

test('folder validation rejects missing, populated and corrupt destinations without changing them', t => {
  const dir = fixture(t);
  assert.throws(() => validateLibraryTarget(path.join(dir, 'offline')), { code: 'ENOENT' });
  fs.writeFileSync(path.join(dir, 'draft.txt'), 'Keep this text');
  assert.throws(() => validateLibraryTarget(dir), /containing library.json/);
  fs.writeFileSync(path.join(dir, 'library.json'), '{}');
  assert.throws(() => validateLibraryTarget(dir), /invalid/);
  assert.equal(fs.readFileSync(path.join(dir, 'draft.txt'), 'utf8'), 'Keep this text');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-location-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('unavailable saved library fails without creating a replacement', t => {
  const dir = path.join(fixture(t), 'offline-share');
  assert.throws(() => prepareLibrary(dir), { code: 'ENOENT' });
  assert.equal(fs.existsSync(dir), false);
});

test('explicit initialization creates an empty library and existing books are preserved', t => {
  const dir = path.join(fixture(t), 'new');
  const file = prepareLibrary(dir, { initialize: true, seed });
  const existing = JSON.stringify({ firstRunDone: true, shelves: [{ bookIds: ['book-one'] }] });
  fs.writeFileSync(file, existing);
  prepareLibrary(dir, { initialize: true, seed });
  assert.equal(fs.readFileSync(file, 'utf8'), existing);
});

test('a missing catalog in a populated folder is never replaced', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'book-one'));
  assert.throws(() => prepareLibrary(dir, { initialize: true, seed }), /contains files/);
  assert.equal(fs.existsSync(path.join(dir, 'library.json')), false);
});

test('invalid catalogs are reported and left unchanged', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'library.json');
  for (const content of ['broken json', '{}', '{"shelves":[{}]}']) {
    fs.writeFileSync(file, content);
    assert.throws(() => prepareLibrary(dir, { initialize: true, seed }));
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});
