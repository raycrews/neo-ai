// Isolated Settings workflow: never reads the user's books or preferences.
const { app, BrowserWindow, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-instruction-ui-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'books');
fs.mkdirSync(device); fs.mkdirSync(libraryDir);
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir }));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({ firstRunDone: true, authorName: 'Test', shelves: [], coverArt: { auto: false } }));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
require(process.env.NEO_INSTRUCTIONS_PACKAGED ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(fn, label) { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await fn()) return; await pause(50); } throw new Error('Timed out: ' + label); }
const settings = () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html'));
let oldClipboard;
app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')), 'workspace');
  const owner = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
  await until(() => evaluate(owner, '!!window.neo && typeof library !== "undefined" && !!library'), 'bookshelf');
  await evaluate(owner, 'window.neo.openSettings()'); await until(() => !!settings(), 'settings');
  let win = settings();
  const click = selector => evaluate(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
  const edit = (selector, value) => evaluate(win, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const saved = () => until(() => evaluate(win, `document.querySelector('#instruction-status').textContent === 'Entry saved.'`), 'entry saved');
  await until(() => evaluate(win, `!!window.instructionLibraryEditsPending && !document.querySelector('#instruction-new').disabled`), 'library ready');
  const activeBefore = await evaluate(win, 'window.settingsAPI.assistants()');
  const untrusted = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../settings-preload.js'), sandbox: true, contextIsolation: true } });
  await untrusted.loadURL('about:blank');
  assert.equal(await evaluate(untrusted, 'window.settingsAPI.instructionLibrary().then(()=>false,e=>e.message)'), 'Settings request denied.'); untrusted.destroy();
  await click('[data-page="ai"]'); await click('[data-ai-view="instruction-library"]');
  const text = 'Preserve the author’s voice.\n\nKeep established facts separate from suggestions.\n';
  await edit('#instruction-name', 'Mystery — Characters'); await edit('#instruction-text', text);
  await click('#instruction-save'); await saved();
  await click('#instruction-duplicate'); await edit('#instruction-name', 'Gemma — Fiction editing'); await click('#instruction-save'); await saved();
  assert.equal((await evaluate(win, 'window.settingsAPI.instructionLibrary()')).length, 2);
  await click('#instruction-rename'); await edit('#instruction-name', 'Gemma — Rewrite'); await click('#instruction-save'); await saved();
  await edit('#instruction-text', 'Unsaved edit');
  await evaluate(win, 'window.confirm=()=>false; undefined'); await click('#instruction-new');
  assert.equal(await evaluate(win, 'document.querySelector("#instruction-text").value'), 'Unsaved edit');
  await click('[data-page="general"]'); await click('#browse-library');
  assert.match(await evaluate(win, 'document.querySelector("#library-status").textContent'), /pending settings/);
  await click('[data-page="ai"]'); await click('#instruction-revert');
  assert.equal(await evaluate(win, 'document.querySelector("#instruction-text").value'), text);
  oldClipboard = clipboard.availableFormats().map(format => [format, clipboard.readBuffer(format)]);
  win.show(); win.focus(); await pause(300); await click('#instruction-copy');
  await until(() => evaluate(win, `document.querySelector('#instruction-status').textContent === 'Instructions copied.'`), 'copy completed');
  assert.equal(clipboard.readText().replace(/\r\n/g, '\n'), text);
  clipboard.clear(); for (const [format, value] of oldClipboard) clipboard.writeBuffer(format, value); oldClipboard = null;
  const exportFile = path.join(scratch, 'export.txt');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportFile });
  await click('#instruction-export'); await until(() => fs.existsSync(exportFile), 'export'); assert.equal(fs.readFileSync(exportFile, 'utf8'), text);
  await until(() => evaluate(win, '!window.instructionLibraryEditsPending()'), 'export complete');
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await click('#instruction-import'); await until(() => evaluate(win, '!window.instructionLibraryEditsPending()'), 'canceled import');
  assert.equal(await evaluate(win, 'document.querySelector("#instruction-text").value'), text);
  const importFile = path.join(scratch, 'Imported.txt'); fs.writeFileSync(importFile, text.repeat(1000));
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [importFile] });
  await click('#instruction-import'); await until(() => evaluate(win, 'document.querySelector("#instruction-status").textContent.includes("Text imported")'), 'import');
  await click('#instruction-save'); await saved();
  assert.equal((await evaluate(win, 'window.settingsAPI.instructionLibrary()')).find(e => e.name === 'Imported').text, text.repeat(1000));
  await evaluate(win, 'window.confirm=()=>true; undefined'); await click('#instruction-delete');
  await until(() => evaluate(win, 'document.querySelector("#instruction-status").textContent === "Entry deleted."'), 'delete');
  assert.deepEqual(await evaluate(win, 'window.settingsAPI.assistants()'), activeBefore);
  assert.equal(fs.existsSync(path.join(device, 'ai-assistants.json')), false);
  // Show normal-size and minimum-size layouts, and verify no horizontal overflow.
  for (const [theme, width, height] of [['dark', 1080, 880], ['light', 800, 640]]) {
    await evaluate(win, `window.settingsAPI.saveAppearance({theme:${JSON.stringify(theme)},accent:'#c9a86a'})`);
    win.setSize(width, height); win.showInactive(); await pause(400);
    assert.equal(await evaluate(win, 'document.documentElement.scrollWidth <= innerWidth'), true);
    fs.writeFileSync(path.join(scratch, theme + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  await edit('#instruction-text', 'Keep this draft');
  let closePrompts = 0; dialog.showMessageBoxSync = () => { closePrompts++; return 0; };
  win.close(); await pause(300); assert.equal(win.isDestroyed(), false); assert.equal(closePrompts, 1);
  await click('#instruction-revert'); win.close(); await until(() => !settings(), 'closed');
  await evaluate(owner, 'window.neo.openSettings()'); await until(() => !!settings(), 'reopened'); win = settings();
  await until(() => evaluate(win, '!!window.instructionLibraryEditsPending && !document.querySelector("#instruction-new").disabled'), 'reloaded');
  assert.equal((await evaluate(win, 'window.settingsAPI.instructionLibrary()')).length, 2);
  console.log('Instruction library UI passed. Screenshots: ' + scratch); app.exit(0);
}).catch(error => {
  if (oldClipboard) { clipboard.clear(); for (const [format, value] of oldClipboard) clipboard.writeBuffer(format, value); }
  console.error(error); app.exit(1);
});
setTimeout(() => { console.error('Instruction library test timed out'); app.exit(1); }, 90000).unref();
