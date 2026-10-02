const { app, BrowserWindow, dialog, nativeTheme } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-general-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(path.join(libraryDir, 'book-one', 'chapters'), { recursive: true });
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir }));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({ firstRunDone: true, pageTheme: 'night', authorName: 'Fixture', hintShown: true, coverArt: { auto: false }, shelves: [{ id: 'shelf', name: 'Works in progress', bookIds: ['book-one'] }] }));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'book.json'), JSON.stringify({ id: 'book-one', title: 'Under the Stars', author: 'Fixture', chapterOrder: ['ch-one'], workspaceTree: { characters: [{ id: 'card', type: 'document', title: 'Elara', text: 'A character reference.' }] } }));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'chapters', 'ch-one.html'), '<p>A scene under the stars.</p>');
fs.writeFileSync(path.join(libraryDir, 'book-one', 'ai-chats.json'), JSON.stringify({ version: 1, selectedId: 'chat-one', conversations: [{ id: 'chat-one', title: 'Character ideas', draft: '', contextIds: [], messages: [{ id: 'prompt', role: 'user', content: 'Suggest a detail about Elara.', status: 'complete' }, { id: 'reply', role: 'assistant', content: '### A suggestion\n\n**Elara** keeps a journal.\n\n- A place for memories\n- A reminder of her goals', status: 'complete' }] }] }));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
const errors = [];
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
require('../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(fn, label) { const end = Date.now() + 12000; while (Date.now() < end) { if (await fn()) return; await pause(40); } throw new Error('Timed out: ' + label); }
const find = file => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/' + file));
const settings = () => JSON.parse(fs.readFileSync(path.join(device, 'settings.json')));
async function screenshot(win, name) { win.showInactive(); await pause(500); fs.writeFileSync(path.join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG()); win.hide(); }
app.whenReady().then(async () => {
  await until(() => find('index.html'), 'owner'); const owner = find('index.html'); owner.setSize(1400, 1000);
  await until(() => evaluate(owner, 'typeof library !== "undefined" && !!library && !!window.neoAppearanceState'), 'startup');
  await evaluate(owner, 'openBook("book-one")');
  const paper = await evaluate(owner, 'getComputedStyle(document.querySelector(".sheet")).backgroundColor');
  await evaluate(owner, 'window.neo.openSettings()'); await until(() => find('settings.html'), 'settings'); let win = find('settings.html');
  await until(() => evaluate(win, 'typeof loaded !== "undefined" && loaded && !!window.neoAppearanceState'), 'settings ready');
  await evaluate(win, 'document.querySelector("[data-page=general]").click()');
  await screenshot(win, 'general-dark');
  await evaluate(owner, 'detachOutline()'); await until(() => find('pane.html'), 'outline'); const outline = find('pane.html');
  await evaluate(owner, 'switchTab("ai-assistance")'); await until(() => evaluate(owner, '!!window.neoChatView.current()'), 'chat');
  await evaluate(owner, 'window.neoChatView.detachButton.click()'); await until(() => find('ai-pane.html'), 'detached chat'); const chat = find('ai-pane.html');
  await until(() => evaluate(chat, '!!window.neoAppearanceState'), 'chat ready');
  async function choose(theme, accent) {
    await evaluate(win, `(() => {document.querySelector('#accent-color').value=${JSON.stringify(accent)};const select=document.querySelector('#appearance-theme');select.value=${JSON.stringify(theme)};select.dispatchEvent(new Event('change'))})()`);
    await until(() => settings().appearance?.theme === theme && settings().appearance?.accent === accent && evaluate(win, 'document.querySelector("#appearance-status").textContent === "Appearance saved."'), 'appearance saved');
  }
  await choose('light', '#639fe8');
  for (const window of [owner, win, outline, chat]) {
    await until(() => evaluate(window, 'document.documentElement.dataset.appTheme === "light"'), 'all windows light');
    assert.equal(await evaluate(window, 'window.neoAppearanceState.accent'), '#639fe8');
    assert.equal(await evaluate(window, 'getComputedStyle(document.body).backgroundColor'), 'rgb(244, 243, 239)');
  }
  assert.equal(await evaluate(owner, 'getComputedStyle(document.querySelector(".sheet")).backgroundColor'), paper);
  await screenshot(win, 'general-light'); await screenshot(chat, 'chat-light'); await screenshot(outline, 'outline-light');
  await evaluate(owner, 'switchTab("manuscript")'); await screenshot(owner, 'manuscript-light');
  await evaluate(owner, 'openWorkspaceNode("characters","card")'); await screenshot(owner, 'document-light');
  // Appearance never changes the book's paper preference.
  assert.equal(await evaluate(owner, 'library.pageTheme'), 'night');
  await choose('system', '#aa86dd');
  const originalSource = nativeTheme.themeSource;
  nativeTheme.themeSource = 'light'; await until(() => evaluate(owner, 'document.documentElement.dataset.appTheme === "light"'), 'system light');
  nativeTheme.themeSource = 'dark'; await until(() => evaluate(owner, 'document.documentElement.dataset.appTheme === "dark"'), 'system dark');
  nativeTheme.themeSource = originalSource;
  // Invalid values and failed writes cannot replace a saved theme.
  assert.match(await evaluate(win, 'window.settingsAPI.saveAppearance({theme:"invalid",accent:"red"}).then(()=>"",e=>e.message)'), /valid theme/);
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === path.join(device, 'settings.json')) { const error = new Error('Fixture disk full'); error.code = 'ENOSPC'; throw error; } return originalRename(from, to); };
    assert.match(await evaluate(win, 'window.settingsAPI.saveAppearance({theme:"light",accent:"#000000"}).then(()=>"",e=>e.message)'), /Could not save/);
    assert.equal(settings().appearance.theme, 'system');
  } finally { fs.renameSync = originalRename; }
  await choose('dark', '#4eb9a7');
  owner.reload(); await until(() => !owner.webContents.isLoadingMainFrame() && evaluate(owner, 'typeof library !== "undefined" && !!library && window.neoAppearanceState?.accent === "#4eb9a7"'), 'workspace reload');
  await screenshot(owner, 'bookshelf-dark');
  await evaluate(owner, 'openBook("book-one")');
  await evaluate(owner, 'openWorkspaceNode("characters","card")');
  win.close(); await until(() => win.isDestroyed(), 'settings closed');
  await evaluate(owner, 'window.neo.openSettings()'); await until(() => find('settings.html'), 'settings reopened'); win = find('settings.html');
  await until(() => evaluate(win, 'window.neoAppearanceState?.accent === "#4eb9a7" && typeof loaded !== "undefined" && loaded'), 'preferences persisted');
  await evaluate(win, 'document.querySelector("[data-page=general]").click();document.querySelector("#appearance-defaults").click()');
  await until(() => settings().appearance?.accent === '#c9a86a' && evaluate(win, 'document.querySelector("#appearance-status").textContent === "Appearance saved."'), 'defaults saved');
  assert.equal(settings().appearance.theme, 'dark');
  // Browse is cancelable, validates first, blocks unsaved settings and flushes books.
  const originalPicker = dialog.showOpenDialog, originalExit = app.exit, originalRelaunch = app.relaunch;
  let restart = null, exit = null, picked = null, calls = 0;
  const nextLibrary = path.join(scratch, 'next-library'); fs.mkdirSync(nextLibrary);
  const badLibrary = path.join(scratch, 'not-a-library'); fs.mkdirSync(badLibrary); fs.writeFileSync(path.join(badLibrary, 'manuscript.txt'), 'Keep me');
  dialog.showOpenDialog = async () => { calls++; return picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }; };
  app.relaunch = options => { restart = options; }; app.exit = code => { exit = code; };
  async function browse() { await evaluate(win, 'document.querySelector("#browse-library").click()'); await until(() => evaluate(win, '!document.querySelector("#browse-library").disabled'), 'browse completed'); }
  try {
    await browse(); assert.equal(settings().libraryDir, libraryDir); assert.equal(exit, null);
    picked = badLibrary; await browse(); assert.match(await evaluate(win, 'document.querySelector("#library-status").textContent'), /containing library.json/); assert.equal(settings().libraryDir, libraryDir);
    picked = path.join(scratch, 'offline-share'); await browse(); assert.equal(settings().libraryDir, libraryDir); assert.equal(fs.existsSync(picked), false);
    picked = libraryDir; await browse(); assert.match(await evaluate(win, 'document.querySelector("#library-status").textContent'), /already open/);
    const before = calls; await evaluate(win, 'dirty=true'); await browse(); assert.equal(calls, before); await evaluate(win, 'dirty=false');
    await evaluate(owner, `const editor=document.querySelector('.tree-document-text');editor.textContent='Saved before the library switch';editor.dispatchEvent(new Event('input',{bubbles:true}))`);
    picked = nextLibrary; await browse(); await until(() => exit === 0, 'restart');
    assert.ok(restart); assert.equal(settings().libraryDir, nextLibrary);
    assert.equal(JSON.parse(fs.readFileSync(path.join(libraryDir, 'book-one', 'book.json'))).workspaceTree.characters[0].text, 'Saved before the library switch');
    assert.equal(fs.readdirSync(nextLibrary).length, 0); // Selection has not migrated or overwritten any files.
  } finally { dialog.showOpenDialog = originalPicker; app.exit = originalExit; app.relaunch = originalRelaunch; }
  assert.deepEqual(errors, []);
  console.log('PASS: themes, accents, system changes, all windows, independent paper, persistence/defaults, failed saves, Browse cancellation/validation and saved edits before restart.');
  console.log('Screenshots: ' + scratch); app.exit(0);
}).catch(error => { console.error(error); console.error(errors); app.exit(1); });
setTimeout(() => { console.error('General settings test timed out'); app.exit(1); }, 90000).unref();
