const { test } = require('node:test');
const assert = require('node:assert/strict');
const { textMenuTemplate } = require('../text-context-menu');

test('read-only selections expose copying but no editing actions', () => {
  const menu = textMenuTemplate({ selectionText: 'A suggestion', editFlags: { canCopy: true, canSelectAll: true } });
  assert.deepEqual(menu.filter(item => item.role).map(item => item.role), ['copy', 'selectAll']);
  assert.equal(menu[0].enabled, true);
  assert.deepEqual(textMenuTemplate({ selectionText: '' }), []);
});

test('editable menu respects renderer capabilities and translated labels', () => {
  const menu = textMenuTemplate({ isEditable: true, editFlags: { canUndo: true, canPaste: true, canSelectAll: true } }, text => 'Translated ' + text);
  const byRole = Object.fromEntries(menu.filter(item => item.role).map(item => [item.role, item]));
  assert.equal(byRole.undo.enabled, true);
  assert.equal(byRole.redo.enabled, false);
  assert.equal(byRole.cut.enabled, false);
  assert.equal(byRole.copy.enabled, false);
  assert.equal(byRole.paste.enabled, true);
  assert.equal(byRole.pasteAndMatchStyle.enabled, true);
  assert.equal(byRole.delete.enabled, false);
  assert.equal(byRole.copy.label, 'Translated Copy');
});
