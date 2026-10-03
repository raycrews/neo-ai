const test = require('node:test');
const assert = require('node:assert/strict');
const { menuActionEnabled: enabled } = require('../menu-policy');
test('menus require loaded workspace and scope book, manuscript and selection commands', () => {
  assert.equal(enabled('export'), false);
  const shelf = { ready: true };
  assert.equal(enabled('export', shelf), false);
  assert.equal(enabled('import', shelf), true);
  assert.equal(enabled('searchBook', { ...shelf, book: true }), true);
  assert.equal(enabled('bodyFont', { ...shelf, book: true }), false);
  assert.equal(enabled('bodyFont', { ...shelf, book: true, manuscript: true }), true);
  assert.equal(enabled('align', { ...shelf, selection: true }), true);
  assert.equal(enabled('poetry', { ...shelf, selection: true }), false);
  assert.equal(enabled('poetry', { ...shelf, manuscriptSelection: true }), true);
});
test('separate windows and dialogs cannot trigger hidden workspace edits', () => {
  const state = { ready: true, book: true, manuscript: true, selection: true, manuscriptSelection: true };
  for (const type of ['export', 'find', 'searchBook', 'align', 'poetry', 'import', 'bodyFont']) {
    assert.equal(enabled(type, state, false), false);
    assert.equal(enabled(type, { ...state, modal: true }), false);
  }
  assert.equal(enabled('help', state, false), true);
  assert.equal(enabled('about', { ...state, modal: true }), false);
});
