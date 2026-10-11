// Verify packaged first-run behavior without touching existing settings or books.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-clean-start-'));
const device = path.join(scratch, 'device'), documents = path.join(scratch, 'documents');
fs.mkdirSync(device); fs.mkdirSync(documents);
if (process.env.NEO_TEST_FRESH) {
  fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir: '/previous/library', appearance: { theme: 'light' } }));
  fs.writeFileSync(path.join(device, 'fresh-setup-request'), 'fresh');
}
app.setPath('userData', device); app.setPath('documents', documents);
process.env.NEO_TEST_HEADLESS = '1';
require('../dist/win-unpacked/resources/app.asar/main.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(fn) { const end = Date.now() + 15000; while (Date.now() < end) { if (await fn()) return; await pause(50); } throw new Error('Clean startup timed out'); }
const find = file => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/' + file));
app.whenReady().then(async () => {
  await until(() => find('index.html')); const owner = find('index.html');
  await until(() => evaluate(owner, 'typeof library !== "undefined" && !!library'));
  const newDevice = app.getPath('userData');
  const prefs = fs.existsSync(path.join(newDevice, 'settings.json')) ? JSON.parse(fs.readFileSync(path.join(newDevice, 'settings.json'))) : {};
  const library = JSON.parse(fs.readFileSync(path.join(prefs.libraryDir || path.join(documents, 'Neo-AI Library'), 'library.json')));
  if (process.env.NEO_TEST_FRESH) { assert.notEqual(newDevice, device); assert.equal(JSON.parse(fs.readFileSync(path.join(device, 'settings.json'))).libraryDir, '/previous/library'); }
  assert.equal(library.firstRunDone, false);
  assert.equal(library.authorName, '');
  assert.equal(library.emailAddress, undefined);
  assert.equal(library.shelves.flatMap(shelf => shelf.bookIds).length, 0);
  assert.equal(await evaluate(owner, '!![...document.querySelectorAll(".modal-backdrop")].find(e=>!e.hidden && e.getClientRects().length && e.textContent.includes("Welcome to Neo-AI"))'), true);
  await evaluate(owner, 'window.neo.openSettings()'); await until(() => find('settings.html'));
  const settings = find('settings.html'); await until(() => evaluate(settings, '!!window.settingsAPI'));
  assert.equal((await evaluate(settings, 'window.settingsAPI.read()')).profiles.length, 0);
  assert.deepEqual(await evaluate(settings, 'window.settingsAPI.instructionLibrary()'), []);
  console.log('PASS: clean packaged startup shows onboarding with no author, email, books, AI connections, or instruction library entries.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(1), 25000).unref();
