const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoredBounds } = require('../pane-windows');
const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: -1280, y: 0, width: 1280, height: 984 } }];

test('restores a pane on a second monitor with negative coordinates', () => {
  const saved = { x: -1200, y: 30, width: 600, height: 700 };
  assert.deepEqual(restoredBounds(saved, displays), saved);
});
test('uses system placement when the saved monitor is disconnected', () => {
  assert.deepEqual(restoredBounds({ x: 3000, y: 10, width: 600, height: 700 }, displays), { width: 560, height: 740 });
});
test('keeps the whole window visible when display size changes', () => {
  assert.deepEqual(restoredBounds({ x: 1800, y: 900, width: 900, height: 1500 }, displays),
    { x: 1020, y: 0, width: 900, height: 1040 });
});
test('ignores malformed stored bounds', () => {
  assert.deepEqual(restoredBounds({ width: 'large', height: 500 }, displays), { width: 560, height: 740 });
  assert.deepEqual(restoredBounds(null, displays), { width: 560, height: 740 });
});
