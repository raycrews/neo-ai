// Real editing commands in an isolated library; never open the author's data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-formatting-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(path.join(libraryDir, 'book-one', 'chapters'), {recursive:true});
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({libraryDir}));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'book.json'), JSON.stringify({id:'book-one',title:'Formatting fixture',chapterOrder:['ch-one'],workspaceTree:{characters:[{id:'card',type:'document',title:'Character card',text:'Sarah has a secret.'},{id:'folder',type:'folder',title:'Cast',children:[]}]}}));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'chapters', 'ch-one.html'), '<p>The scene begins here.</p>');
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({firstRunDone:true,authorName:'Fixture',hintShown:true,coverArt:{auto:false},shelves:[{id:'shelf',name:'Shelf',bookIds:['book-one']}]}));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
const errors = [];
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => {if(event.level === 'error') errors.push(event.message)}));
require('../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let owner;
const evaluate = code => owner.webContents.executeJavaScript(code, true);
async function until(fn, label) {const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await pause(40)}throw new Error('Timed out: '+label)}
async function selectText(selector) {
  await evaluate(`(() => {const editor=document.querySelector(${JSON.stringify(selector)});editor.focus();const range=document.createRange();range.selectNodeContents(editor);const s=getSelection();s.removeAllRanges();s.addRange(range)})()`);
  await until(() => evaluate('!document.querySelector("#document-formatting button").disabled'), 'toolbar enabled');
}
async function click(command) {
  const {x,y}=await evaluate(`(() => {const r=document.querySelector('#document-formatting [data-command="${command}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  owner.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  owner.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
  await pause(80);
}
async function choose(label, value) {
  await evaluate(`(() => {const control=document.querySelector('#document-formatting [aria-label="${label}"]');control.focus();control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await pause(80);
}
app.whenReady().then(async () => {
  await until(() => (owner=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'))), 'window');
  owner.setSize(1400,1000);owner.webContents.setBackgroundThrottling(false);
  await until(() => evaluate('typeof library!=="undefined" && !!library && !!window.neoChatView'), 'startup');
  await evaluate('openBook("book-one")');
  await evaluate('openWorkspaceNode("characters","card")');
  await until(() => evaluate('!document.querySelector("#document-formatting").hidden'), 'document toolbar');
  await selectText('.tree-document-text');await click('bold');
  assert.match(await evaluate('document.querySelector(".tree-document-text").innerHTML'), /<(b|strong)>/);
  assert.equal(await evaluate('document.querySelector("#document-formatting [data-command=bold]").getAttribute("aria-pressed")'), 'true');
  await evaluate('document.execCommand("undo")');
  assert.doesNotMatch(await evaluate('document.querySelector(".tree-document-text").innerHTML'), /<(b|strong)>/);
  await evaluate('document.execCommand("redo")');
  await selectText('.tree-document-text');await click('italic');await click('underline');await click('strikeThrough');
  await choose('Paragraph style','h2');await choose('Text alignment','justifyCenter');
  await evaluate('flushAllSaves()');
  await evaluate('switchTab("locations");openWorkspaceNode("characters","card")');
  assert.equal(await evaluate('document.querySelector(".tree-document-text h2").textContent'), 'Sarah has a secret.');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tree-document-text h2")).textAlign'), 'center');
  for(const tag of ['b','i','u','strike']) assert.equal(await evaluate(`!!document.querySelector('.tree-document-text ${tag}')`), true, tag+' survived');
  await selectText('.tree-document-text');await choose('Paragraph style','p');await click('insertUnorderedList');
  assert.equal(await evaluate('!!document.querySelector(".tree-document-text ul li")'),true);
  await click('insertOrderedList');
  assert.equal(await evaluate('!!document.querySelector(".tree-document-text ol li")'),true);
  await evaluate('flushAllSaves()');
  const saved=JSON.parse(fs.readFileSync(path.join(libraryDir,'book-one','book.json'),'utf8')).workspaceTree.characters[0].html;
  assert.match(saved,/<ol>/);
  owner.showInactive();await pause(450);fs.writeFileSync(path.join(scratch,'toolbar.png'),(await owner.webContents.capturePage()).toPNG());owner.hide();
  owner.setSize(800,800);await pause(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.equal(await evaluate('document.querySelector("#workspace-comments-toggle").getBoundingClientRect().right <= innerWidth'),true);
  owner.setSize(1400,1000);
  await evaluate('openWorkspaceNode("characters","folder")');
  await until(() => evaluate('document.querySelector("#document-formatting").hidden'), 'folder hidden');
  await evaluate('switchTab("manuscript")');await selectText('.chapter-body');await click('bold');await choose('Paragraph style','h3');
  await evaluate('flushAllSaves()');
  assert.match(fs.readFileSync(path.join(libraryDir,'book-one','chapters','ch-one.html'),'utf8'), /<h3>/);
  await evaluate('switchTab("ai-assistance")');
  await until(() => evaluate('window.neoChatView.current() && document.querySelector("#document-formatting").hidden'), 'chat toolbar hidden');
  // Chat nodes remain chats even after being moved to a different section.
  await evaluate(`(() => {const item=workspaceChatNodes()[0];return moveWorkspaceItem(item.section,item.node.id,null,null,'characters').then(()=>openWorkspaceNode('characters',item.node.id))})()`);
  await until(() => evaluate('!window.neoChatView.root.hidden && document.querySelector("#document-formatting").hidden'), 'moved chat hidden');
  await evaluate('window.neoChatView.detachButton.click()');
  await until(() => BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/ai-pane.html')), 'detached chat');
  const pane=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/ai-pane.html'));
  assert.equal(await pane.webContents.executeJavaScript('!!document.querySelector("#document-formatting")'),false);
  await evaluate('openWorkspaceNode("characters","card")');
  await until(() => evaluate('!document.querySelector("#document-formatting").hidden'), 'document with detached chat');
  await evaluate('flushAllSaves()');owner.reload();
  await until(() => !owner.webContents.isLoadingMainFrame() && evaluate('typeof library!=="undefined" && !!library && !!window.neoChatView'), 'reload');
  await evaluate('openBook("book-one")');await evaluate('openWorkspaceNode("characters","card")');
  assert.equal(await evaluate('!!document.querySelector(".tree-document-text ol li")'),true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tree-document-text li")).textAlign'), 'center');
  assert.deepEqual(errors,[]);
  console.log('PASS: selection, formatting, native undo/redo, autosave/reload, narrow header, folders and chat exclusion (including moved/detached chats).');
  console.log('Screenshot: '+path.join(scratch,'toolbar.png'));
  app.exit(0);
}).catch(error=>{console.error(error);console.error(errors);app.exit(1)});
setTimeout(()=>{console.error('Formatting test timed out');app.exit(1)},60000).unref();
