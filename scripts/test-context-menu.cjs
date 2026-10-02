// Exercise real right-click events and native menu actions in a temporary book.
const { app, BrowserWindow, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-context-menu-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(path.join(libraryDir, 'book-one', 'chapters'), {recursive:true});
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({libraryDir}));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'book.json'), JSON.stringify({id:'book-one',title:'Menu fixture',chapterOrder:['ch-one'],workspaceTree:{characters:[{id:'card',type:'document',title:'Character card',text:''}]}}));
fs.writeFileSync(path.join(libraryDir, 'book-one', 'chapters', 'ch-one.html'), '<p>A manuscript paragraph.</p>');
fs.writeFileSync(path.join(libraryDir, 'book-one', 'ai-chats.json'), JSON.stringify({version:1,selectedId:'chat-one',conversations:[{id:'chat-one',title:'Suggestions',messages:[{id:'reply',role:'assistant',content:'### Appearance\n\n**Elara** wears a blue coat.',status:'complete'}],draft:'',contextIds:[]}]}));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({firstRunDone:true,authorName:'Fixture',hintShown:true,coverArt:{auto:false},shelves:[{id:'shelf',name:'Shelf',bookIds:['book-one']}]}));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
let shown = null;
// Inspect the actual native menu and invoke its role without leaving an OS popup
// open during automation. The renderer still receives real mouse events.
Menu.prototype.popup = function(options) { shown = { menu:this, options }; };
const errors = [];
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => {if(event.level === 'error') errors.push(event.message)}));
require('../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win,code) => win.webContents.executeJavaScript(code,true);
async function until(fn,label) {const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await pause(40)}throw new Error('Timed out: '+label)}
async function select(win,selector,editable=false) {
  await evaluate(win,`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});${editable?'el.focus();':''}if(el.setSelectionRange){el.select();return}const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
}
async function rightClick(win,selector) {
  shown=null;
  const {x,y}=await evaluate(win,`(() => {const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:Math.round(r.x+Math.min(12,r.width/2)),y:Math.round(r.y+Math.min(10,r.height/2))}})()`);
  win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'right',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'right',clickCount:1});
  await until(()=>shown,'right-click menu');
  assert.equal(shown.options.window,win);
  return shown.menu;
}
async function action(menu,role,win) {
  const item=menu.items.find(item=>item.role===role.toLowerCase());
  assert.ok(item,role+' exists'); assert.equal(item.enabled,true,role+' enabled');
  item.click({metaKey:false,ctrlKey:false,altKey:false,shiftKey:false},win,win.webContents);await pause(120);
}
let previousClipboard;
app.whenReady().then(async()=>{
  previousClipboard={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};
  const bookmark=clipboard.readBookmark();if(bookmark.url)previousClipboard.bookmark=bookmark.title;
  let owner;await until(()=> (owner=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'))),'owner');
  owner.setSize(1400,1000);owner.webContents.setBackgroundThrottling(false);
  await until(()=>evaluate(owner,'typeof library!=="undefined" && !!library && !!window.neoChatView'),'startup');
  await evaluate(owner,'openBook("book-one")');await evaluate(owner,'switchTab("ai-assistance")');
  await until(()=>evaluate(owner,'!!document.querySelector(".ai-markdown strong")'),'chat rendered');
  await select(owner,'.ai-markdown p');
  let menu=await rightClick(owner,'.ai-markdown p');
  assert.deepEqual(menu.items.filter(item=>item.role).map(item=>item.role),['copy','selectall']);
  await action(menu,'copy',owner);
  assert.equal(clipboard.readText(),'Elara wears a blue coat.');assert.match(clipboard.readHTML(),/<strong[^>]*>Elara<\/strong>/);
  await evaluate(owner,'openWorkspaceNode("characters","card")');
  await select(owner,'.tree-document-text',true);menu=await rightClick(owner,'.tree-document-text');await action(menu,'paste',owner);
  assert.equal(await evaluate(owner,'document.querySelector(".tree-document-text strong").textContent'),'Elara');
  await select(owner,'.tree-document-text',true);menu=await rightClick(owner,'.tree-document-text');await action(menu,'cut',owner);
  assert.equal(await evaluate(owner,'document.querySelector(".tree-document-text").textContent.trim()'),'');
  menu=await rightClick(owner,'.tree-document-text');await action(menu,'undo',owner);
  assert.match(await evaluate(owner,'document.querySelector(".tree-document-text").textContent'),/blue coat/);
  menu=await rightClick(owner,'.tree-document-text');await action(menu,'redo',owner);
  assert.equal(await evaluate(owner,'document.querySelector(".tree-document-text").textContent.trim()'),'');
  menu=await rightClick(owner,'.tree-document-text');await action(menu,'pasteAndMatchStyle',owner);
  assert.equal(await evaluate(owner,'!!document.querySelector(".tree-document-text strong")'),false);
  assert.match(await evaluate(owner,'document.querySelector(".tree-document-text").textContent'),/blue coat/);
  await evaluate(owner,'flushAllSaves()');
  // Native document copy remains available while custom spellcheck is enabled.
  await evaluate(owner,'switchTab("manuscript");spellOn=true;spellCache.set("manuscript",false)');
  await select(owner,'.chapter-body',true);menu=await rightClick(owner,'.chapter-body p');assert.ok(menu.items.some(item=>item.role==='copy'));
  // Dedicated bookshelf/chapter menus suppress the generic native menu.
  await evaluate(owner,'getSelection().removeAllRanges();document.querySelector(".chapter-head").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
  await evaluate(owner,'document.querySelector(".modal-backdrop")?.remove();spellOn=false;switchTab("ai-assistance")');
  await evaluate(owner,'window.neoChatView.detachButton.click()');
  let pane;await until(()=> (pane=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/ai-pane.html'))),'detached chat');
  await until(()=>evaluate(pane,'!!document.querySelector(".ai-markdown p")'),'detached rendered');
  await select(pane,'.ai-markdown p');menu=await rightClick(pane,'.ai-markdown p');await action(menu,'copy',pane);
  assert.equal(clipboard.readText(),'Elara wears a blue coat.');
  await evaluate(pane,'view.draft.id="fixture-draft";view.draft.scrollIntoView();view.draft.focus()');
  menu=await rightClick(pane,'#fixture-draft');await action(menu,'paste',pane);
  assert.equal(await evaluate(pane,'view.draft.value'),'Elara wears a blue coat.');
  await evaluate(owner,'window.neo.openSettings()');
  let settings;await until(()=> (settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html'))),'settings');
  await until(()=>evaluate(settings,'!!document.querySelector("[data-page=ai]")'),'settings ready');
  await evaluate(settings,'document.querySelector("[data-page=ai]").click()');await select(settings,'#assistant-instructions',true);
  menu=await rightClick(settings,'#assistant-instructions');assert.ok(menu.items.some(item=>item.role==='paste'));
  assert.deepEqual(errors,[]);
  console.log('PASS: real right-click events in chats, detached chat, documents and Settings; rich Copy/Paste, plain paste, Cut, Undo/Redo; selected spelling text retains native actions.');
  clipboard.write(previousClipboard);app.exit(0);
}).catch(error=>{console.error(error);console.error(errors);if(previousClipboard)clipboard.write(previousClipboard);app.exit(1)});
setTimeout(()=>{console.error('Context menu test timed out');if(previousClipboard)clipboard.write(previousClipboard);app.exit(1)},60000).unref();
