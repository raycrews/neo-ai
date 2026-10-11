// Real native selection menu and editor, with an isolated library and mock AI.
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-revision-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(path.join(libraryDir, 'book-one', 'chapters'), { recursive: true });
const original = '<p>Before <strong>the old gate</strong> stood shut.</p><p>A second paragraph.</p>';
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir }));
fs.writeFileSync(path.join(device, 'ai-assistants.json'), JSON.stringify({ version: 1, instructions: { 'edit-rewrite': 'Preserve the fixture narrator’s dry humor.' } }));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'book.json'), JSON.stringify({ id: 'book-one', title: 'Revision fixture', chapterOrder: ['ch-one', 'ch-two'], workspaceTree: { characters: [{ id: 'card', type: 'document', title: 'Card', text: 'Reference prose.' }] } }));
const chapterFile = path.join(libraryDir, 'book-one', 'chapters', 'ch-one.html');
fs.writeFileSync(chapterFile, original);
fs.writeFileSync(path.join(libraryDir, 'book-one', 'chapters', 'ch-two.html'), '<p>SECRET OTHER CHAPTER.</p>');
fs.writeFileSync(path.join(libraryDir, 'book-one', 'ai-chats.json'), JSON.stringify({version:1,selectedId:'chat-one',conversations:[{id:'chat-one',title:'Excluded chat',profileId:'local',model:'fixture-model',draft:'Draft text.',contextIds:[],messages:[{id:'prompt-one',role:'user',content:'A question.',status:'complete'},{id:'reply-one',role:'assistant',content:'An answer.',status:'complete'}]}]}));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({ firstRunDone: true, authorName: 'Fixture', hintShown: true, coverArt: { auto: false }, shelves: [{ id: 'shelf', name: 'Shelf', bookIds: ['book-one'] }] }));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
let shown, reply = 'the weathered gate', mode = 'normal'; const requests = [], errors = [];
Menu.prototype.popup = function(options) { shown = { menu: this, options }; };
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  if (mode === 'error') { res.writeHead(401); return res.end('private body'); }
  res.setHeader('Content-Type', 'text/event-stream');
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: mode === 'blank' ? '' : reply } }] }) + '\n\n');
  if (mode === 'slow') return;
  res.end('data: [DONE]\n\n');
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(device, 'ai-connections.json'), JSON.stringify({ version: 1, defaultId: 'local', profiles: [{ id: 'local', name: 'Mock connection', provider: 'lmstudio', api: 'chat', model: 'fixture-model', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', discoveredModels: ['fixture-model', 'second-model'], responseSettings: [{ model: 'fixture-model', maxReplyTokens: 512, temperature: 0.4 }] }] })));
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
require(process.env.NEO_REVISION_PACKAGED ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => owner.webContents.executeJavaScript(code, true);
async function until(fn, label) { const end = Date.now() + 16000; while (Date.now() < end) { if (await fn()) return; await pause(40); } throw Error('Timed out: ' + label); }
let owner;
const q = selector => `document.querySelector('#manuscript-revision ${selector}')`;
const click = selector => evaluate(`${q(selector)}.click()`);
const content = () => evaluate('document.querySelector(".chapter-body").innerHTML');
async function select(selector = '.chapter-body strong') {
  return evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});el.closest('[contenteditable]')?.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);return window.neoRevision.capture()})()`);
}
async function open(action = 'rewrite') {
  assert.equal(await select(), true);
  shown = null;
  const point = await evaluate(`(() => {const r=document.querySelector('.chapter-body strong').getBoundingClientRect();return {x:Math.round(r.x+3),y:Math.round(r.y+3)}})()`);
  owner.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
  owner.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
  await until(() => shown, 'native menu');
  const menu = shown.menu.items.find(i => i.label === 'AI revision'); assert.ok(menu);
  assert.deepEqual(menu.submenu.items.map(i => i.label), ['Rewrite', 'Expand', 'Shorten', 'Custom instruction']);
  menu.submenu.items[['rewrite', 'expand', 'shorten', 'custom'].indexOf(action)].click();
  try { await until(() => evaluate(`${q('[data-model]')}.value === 'fixture-model' && document.querySelector('#manuscript-revision').open`), 'preview'); }
  catch (error) { console.error(await evaluate(`({open:document.querySelector('#manuscript-revision').open,status:${q('[data-status]')}.textContent, model:${q('[data-model]')}.value,selection:getSelection().toString(),html:document.querySelector('.chapter-body').innerHTML})`)); throw error; }
}
async function generate() { await click('[data-generate]'); await until(() => evaluate(`!${q('[data-accept]')}.disabled`), 'proposal'); }
async function close() { await click('[data-close]'); await pause(100); }
async function rightClick(selector) {
  shown = null;
  const point = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10)}})()`);
  owner.webContents.sendInputEvent({type:'mouseDown', ...point, button:'right', clickCount:1});
  owner.webContents.sendInputEvent({type:'mouseUp', ...point, button:'right', clickCount:1});
  await until(() => shown, 'right-click menu');
  return shown.menu.items.find(item => item.label === 'AI revision');
}
async function openNativeSelection(selector, expected = true) {
  await select(selector);
  const item = await rightClick(selector); assert.equal(!!item, expected, selector + ' AI actions');
  if (!expected) return;
  item.submenu.items[0].click();
  await until(() => evaluate(`document.querySelector('#manuscript-revision').open && !${q('[data-generate]')}.disabled`), 'native selection preview');
}
app.whenReady().then(async () => {
  await until(() => (owner = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'))), 'owner');
  owner.setSize(1400, 1000); owner.webContents.setBackgroundThrottling(false);
  await until(() => evaluate('typeof library!=="undefined" && !!library && !!window.neoRevision'), 'startup');
  await evaluate('openBook("book-one")');
  // Native double-click, without a preliminary capture(), exercises the user's
  // selection path rather than a programmatically remembered range.
  owner.show(); owner.focus(); owner.webContents.focus(); await pause(300);
  await evaluate("document.querySelector('.chapter-body strong').scrollIntoView({block:'center'});getSelection().removeAllRanges()");
  const point = await evaluate(`(() => {const r=document.querySelector('.chapter-body strong').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+r.height/2)}})()`);
  owner.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:2});
  owner.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:2});
  await pause(100);
  assert.ok(await evaluate('getSelection().toString().trim()'), 'native mouse selection');
  assert.ok(await rightClick('.chapter-body strong'), 'native selection has AI revision'); owner.hide();
  await open();
  assert.equal(await evaluate(`${q('datalist')}.options.length`), 2);
  const initial = await content();
  await generate(); assert.equal(await content(), initial);
  assert.match(requests[0].messages[0].content, /dry humor/);
  assert.match(requests[0].messages[1].content, /the old gate/);
  assert.doesNotMatch(JSON.stringify(requests[0]), /SECRET OTHER CHAPTER/);
  assert.equal(requests[0].max_tokens, 512); assert.equal(requests[0].temperature, 0.4);
  await close(); assert.equal(await content(), initial);
  await open(); await generate();
  await rightClick('#manuscript-revision [data-result]');
  assert.ok(!shown.menu.items.some(item=>item.label==='AI revision'), 'preview keeps native editing menu');
  owner.showInactive(); await pause(400); fs.writeFileSync(path.join(scratch, 'preview.png'), (await owner.webContents.capturePage()).toPNG());
  owner.setSize(850, 780); await evaluate("document.documentElement.dataset.appTheme='light'"); await pause(250);
  fs.writeFileSync(path.join(scratch, 'preview-light.png'), (await owner.webContents.capturePage()).toPNG());
  owner.setSize(1400, 1000); await evaluate("document.documentElement.dataset.appTheme='dark'"); owner.hide();
  await click('[data-accept]'); await pause(150);
  assert.equal(await evaluate('document.querySelector(".chapter-body").innerText.trim()'), 'Before the weathered gate stood shut.\n\nA second paragraph.');
  await evaluate('flushAllSaves()'); assert.match(fs.readFileSync(chapterFile, 'utf8'), /weathered gate/);
  owner.webContents.undo(); await pause(100); assert.equal(await content(), initial);
  owner.webContents.redo(); await pause(100); assert.match(await content(), /weathered gate/);
  owner.webContents.undo(); await pause(100);
  console.log('PASS: native menu, isolated context, saved instructions/response settings, preview, cancel, exact replacement and native Undo/Redo.');
  for (const action of ['expand', 'shorten', 'custom']) {
    await open(action);
    if (action === 'custom') {
      const count = requests.length; await click('[data-generate]'); assert.equal(requests.length, count);
      await evaluate(`${q('[data-instruction]')}.value='Make the mood ominous.'`);
    }
    await generate(); assert.match(requests.at(-1).messages[0].content, action === 'expand' ? /Expand the selected/ : action === 'shorten' ? /Shorten the selected/ : /additional instruction/);
    if (action === 'custom') assert.match(requests.at(-1).messages[1].content, /ominous/);
    await close();
  }
  await open(); await generate(); reply = 'another proposal'; await generate();
  assert.match(requests.at(-1).messages[1].content, /the old gate/); assert.equal(await evaluate(`${q('[data-result]')}.value`), reply);
  await evaluate(`document.querySelector('.chapter-body').append(document.createTextNode('Changed while waiting.'))`);
  await click('[data-accept]'); assert.match(await evaluate(`${q('[data-status]')}.textContent`), /document changed/);
  await close(); await evaluate(`document.querySelector('.chapter-body').innerHTML=${JSON.stringify(initial)}`);
  mode = 'slow'; await open(); await click('[data-generate]');
  await until(() => requests.at(-1).messages[1].content.includes('the old gate'), 'slow request');
  await pause(100); await click('[data-generate]');
  assert.equal(await evaluate(`${q('[data-accept]')}.disabled`), true); assert.equal(await content(), initial);
  await close(); mode = 'error'; await open(); await click('[data-generate]');
  await until(() => evaluate(`${q('[data-status]')}.textContent.includes('401')`), 'provider error');
  assert.equal(await evaluate(`${q('[data-accept]')}.disabled`), true); await close();
  mode = 'blank'; await open(); await click('[data-generate]');
  await until(() => evaluate(`${q('[data-status]')}.textContent.includes('text') && !${q('[data-action]')}.disabled`), 'blank rejected');
  assert.equal(await evaluate(`${q('[data-accept]')}.disabled`), true); await close();
  mode = 'normal'; reply = 'First line.\n\nSecond line. <img src=x onerror=alert(1)>';
  await open(); await generate(); await click('[data-accept]'); await pause(150);
  assert.equal(await evaluate('!!document.querySelector(".chapter-body img")'), false);
  assert.match(await evaluate('document.querySelector(".chapter-body").innerText'), /First line\.\n[\s\S]*Second line/);
  assert.match(await evaluate('document.querySelector(".chapter-body").innerText'), /^Before First line\.[\s\S]*Second line\. <img src=x onerror=alert\(1\)> stood shut\.[\s\S]*A second paragraph\.$/);
  owner.webContents.undo(); await pause(100); assert.equal(await content(), initial);
  assert.equal(await select('.chapter-body'), true);
  owner.webContents.send('revision:open', 'rewrite');
  await until(() => evaluate('document.querySelector("#manuscript-revision").open'), 'multiple paragraphs');
  assert.match(await evaluate(`${q('[data-original]')}.value`), /shut\.\n\nA second/);
  await until(() => evaluate(`!${q('[data-generate]')}.disabled`), 'paragraph controls');
  reply = 'A revised opening.\n\nA revised ending.'; await generate(); await click('[data-accept]'); await pause(150);
  assert.equal(await evaluate('document.querySelector(".chapter-body").innerText.trim()'), reply);
  owner.webContents.undo(); await pause(100); assert.equal(await content(), initial);
  // Settings exposes independent editable instructions for these four actions.
  await evaluate('window.neo.openSettings()');
  let settings; await until(() => (settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html'))), 'Settings');
  const settingsEval = code => settings.webContents.executeJavaScript(code, true);
  await until(() => settingsEval('document.querySelector("#assistant-type")?.options.length===10'), 'action settings');
  await settingsEval(`document.querySelector('[data-page="ai"]').click(); const picker=document.querySelector('#assistant-type');picker.value='edit-rewrite';picker.dispatchEvent(new Event('change'));`);
  await settingsEval(`const field=document.querySelector('#assistant-instructions');field.value='Use the newly saved revision direction.';field.dispatchEvent(new Event('input'));document.querySelector('#save-assistant').click()`);
  await until(() => settingsEval('document.querySelector("#assistant-status").textContent.includes("Instructions saved")'), 'save action instructions');
  settings.close(); await open(); await generate(); assert.match(requests.at(-1).messages[0].content, /newly saved revision direction/); await close();
  await evaluate('openWorkspaceNode("characters","card")');
  await openNativeSelection('.tree-document-text');
  reply = 'Expanded reference text.'; await generate(); await click('[data-accept]'); await pause(100);
  assert.equal(await evaluate('document.querySelector(".tree-document-text").innerText'), reply);
  await evaluate('flushAllSaves()'); assert.match(fs.readFileSync(path.join(libraryDir,'book-one','book.json'),'utf8'), /Expanded reference text/);
  owner.webContents.undo(); await pause(100);
  assert.equal(await evaluate('document.querySelector(".tree-document-text").innerText'), 'Reference prose.');
  for (const section of ['locations','worldbuilding','research','notes','outline','darlings']) {
    await evaluate(`book.workspaceTree[${JSON.stringify(section)}]=[{id:'section-fixture',type:'document',title:'Fixture',text:'Writing fixture.'}];openWorkspaceNode(${JSON.stringify(section)},'section-fixture')`);
    await openNativeSelection('.tree-document-text', section !== 'darlings');
    if(section !== 'darlings') await close();
  }
  await evaluate("switchTab('notes')");
  await until(() => evaluate("!!document.querySelector('#aux-editor').getClientRects().length"), 'Notes editor');
  await evaluate("document.querySelector('#aux-editor').innerHTML='<p>Book notes.</p>'");
  await openNativeSelection('#aux-editor'); await close();
  await evaluate("book.chapterNotes={'ch-one':'An outline note.'};switchTab('outline')");
  await openNativeSelection('.ol-text'); await generate(); await click('[data-accept]'); await pause(100);
  assert.equal(await evaluate("book.chapterNotes['ch-one']"), reply);
  // Detached outline uses textareas, retaining selection offsets and Undo.
  const workspace = owner;
  await evaluate('detachOutline()');
  await until(() => BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/pane.html')), 'outline pane');
  owner = BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pane.html'));
  owner.setSize(1200,900); owner.webContents.setBackgroundThrottling(false);
  await until(() => evaluate("!!document.querySelector('#outline textarea') && !!window.neoRevision"), 'outline notes');
  await evaluate("document.querySelector('#outline textarea').focus();document.querySelector('#outline textarea').select()");
  const outlineMenu = await rightClick('#outline textarea'); assert.ok(outlineMenu); outlineMenu.submenu.items[0].click();
  await until(() => evaluate(`document.querySelector('#manuscript-revision').open && !${q('[data-generate]')}.disabled`), 'outline revision');
  reply='Revised outline note.'; await generate(); await click('[data-accept]'); await pause(350);
  assert.equal(await evaluate("document.querySelector('#outline textarea').value"), reply);
  owner.webContents.undo(); await pause(250);
  assert.notEqual(await evaluate("document.querySelector('#outline textarea').value"), reply);
  owner=workspace;
  await evaluate('switchTab("ai-assistance")'); assert.equal(await evaluate('window.neoRevision.capture()'), false);
  await until(() => evaluate('!!document.querySelector(".ai-message-content")'), 'chat messages');
  await openNativeSelection('.ai-user .ai-message-content', false);
  await openNativeSelection('.ai-assistant .ai-message-content', false);
  await evaluate('window.neoChatView.draft.focus();window.neoChatView.draft.select()');
  assert.ok(!await rightClick('.ai-composer textarea'), 'chat draft excluded');
  assert.deepEqual(errors, []);
  console.log('PASS: real mouse selection; writing/reference documents, Notes and both Outline windows; Darlings and chat excluded; saving, Undo/Redo, errors and cancellation.');
  server.close(); app.exit(0);
}).catch(error => { console.error(error); console.error(errors); app.exit(1); });
setTimeout(() => { console.error('Revision test timed out'); app.exit(1); }, 120000).unref();
