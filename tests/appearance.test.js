const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAppearance, defaults } = require('../appearance-main');

test('appearance accepts supported themes and normalizes standard hex colors', () => {
  assert.deepEqual(validateAppearance(defaults), { theme: 'dark', accent: '#c9a86a' });
  for (const theme of ['dark', 'light', 'system']) assert.deepEqual(validateAppearance({ theme, accent: '#ABCDEF' }), { theme, accent: '#abcdef' });
});
test('appearance rejects malformed or injectable preferences', () => {
  for (const value of [null, {}, { theme: 'other', accent: '#123456' }, { theme: 'dark', accent: 'red' }, { theme: 'dark', accent: '#123456;url(x)' }]) assert.throws(() => validateAppearance(value));
});
