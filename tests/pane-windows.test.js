const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoredBounds, installPaneWindows } = require('../pane-windows');
const { EventEmitter } = require('node:events');
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

function closingWorkspace() {
  const app = new EventEmitter(), ipcMain = new EventEmitter(), win = new EventEmitter();
  const commands = [];
  ipcMain.handle = () => {};
  win.webContents = new EventEmitter();
  win.webContents.send = (channel, payload) => {
    if (channel === 'panes:command') commands.push(payload);
  };
  let destroyed = false, quitCalls = 0, warnings = 0;
  win.isDestroyed = () => destroyed;
  win.close = () => {
    let prevented = false;
    win.emit('close', { preventDefault: () => { prevented = true; } });
    if (!prevented) { destroyed = true; win.emit('closed'); }
  };
  app.quit = () => { quitCalls++; app.emit('before-quit'); win.close(); };
  installPaneWindows({ app, ipcMain, dialog: { showMessageBox: async () => { warnings++; } } }).attach(win);
  return { app, win, commands, get quitCalls() { return quitCalls; }, get warnings() { return warnings; },
    reply(error) {
      ipcMain.emit('panes:reply', { sender: win.webContents }, { id: commands.at(-1).id, error });
    } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('resumes application quit only after the workspace confirms its saves', async () => {
  const fixture = closingWorkspace();
  fixture.app.quit(); await tick();
  assert.equal(fixture.win.isDestroyed(), false);
  assert.equal(fixture.quitCalls, 1);
  assert.equal(fixture.commands[0].command.type, 'flush');
  fixture.reply(); await tick();
  assert.equal(fixture.win.isDestroyed(), true);
  assert.equal(fixture.quitCalls, 2);
});

test('ordinary window close saves without turning into application quit', async () => {
  const fixture = closingWorkspace();
  fixture.win.close(); await tick(); fixture.reply(); await tick();
  assert.equal(fixture.win.isDestroyed(), true);
  assert.equal(fixture.quitCalls, 0);
});

test('failed saves cancel quit and keep the workspace available for another close', async () => {
  const fixture = closingWorkspace();
  fixture.app.quit(); await tick(); fixture.reply('Disk unavailable'); await tick();
  assert.equal(fixture.win.isDestroyed(), false);
  assert.equal(fixture.warnings, 1);
  fixture.win.close(); await tick(); fixture.reply(); await tick();
  assert.equal(fixture.win.isDestroyed(), true);
  assert.equal(fixture.quitCalls, 1);
});
