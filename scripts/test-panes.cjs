// Integration test against the real Electron main process and both renderers.
// No user library, API keys, external messages, or generated art are used.
const { app, BrowserWindow, dialog, Menu } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-panes-'));
const userData = path.join(scratch, 'settings');
const libraryDir = path.join(scratch, 'library');
const bookDir = path.join(libraryDir, 'book-test');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(path.join(bookDir, 'chapters'), { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ libraryDir }));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({
  firstRunDone: true, authorName: 'Test Author', hintShown: true, pageTheme: 'night',
  coverArt: { auto: false }, shelves: [{ id: 'shelf-1', name: 'Test shelf', bookIds: ['book-test'] }]
}));
fs.writeFileSync(path.join(bookDir, 'book.json'), JSON.stringify({
  id: 'book-test', title: 'Window test', author: 'Test Author',
  chapterOrder: ['ch-one', 'ch-two'], chapterNotes: { 'ch-one': 'Opening', 'ch-two': 'Ending' },
  sectionNotes: {}, tabNames: { notes: 'Notes', outline: 'Outline' }
}));
fs.writeFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), '<p>First chapter prose remains intact.</p>');
fs.writeFileSync(path.join(bookDir, 'chapters', 'ch-two.html'), '<p>Second chapter prose remains intact.</p>');
app.setPath('userData', userData);
process.env.NEO_TEST_HEADLESS = '1';
const rendererErrors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(event.message);
  });
});
// Simulate an unavailable saved NAS before startup. Retry reconnects it;
// no workspace or empty local replacement may appear while it is unavailable.
const startupMessageBox = dialog.showMessageBox;
const unavailableLibrary = path.join(scratch, 'unavailable-nas');
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ libraryDir: unavailableLibrary }));
let recoveredLibrary = false;
dialog.showMessageBox = async (options) => {
  assert.match(options.message, /could not open your library/);
  assert.ok(options.detail.includes(unavailableLibrary));
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  assert.equal(fs.existsSync(unavailableLibrary), false);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ libraryDir }));
  recoveredLibrary = true;
  dialog.showMessageBox = startupMessageBox;
  return { response: 0 };
};
require('../main');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error('Timed out: ' + label);
}
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
const meta = () => JSON.parse(fs.readFileSync(path.join(bookDir, 'book.json'), 'utf8'));
const paneWindow = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/pane.html'));
const check = (label) => console.log('PASS: ' + label);

app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('/index.html')), 'workspace window');
  const owner = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'));
  owner.webContents.setBackgroundThrottling(false);
  await until(() => evaluate(owner, 'typeof library !== "undefined" && !!library && typeof detachOutline === "function"'), 'workspace ready');
  assert.equal(recoveredLibrary, true);
  assert.equal(await evaluate(owner, 'library.firstRunDone'), true);
  check('unavailable saved library offers retry and opens existing books without first-run setup');
  await evaluate(owner, 'openBook("book-test")');
  await evaluate(owner, 'focusChapter("ch-one"); updateCounters()');
  assert.equal(await evaluate(owner, 'document.querySelectorAll(".workspace-tree .n-words").length'), 0);
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").value'), 0);
  async function setTarget(kind, value) {
    await evaluate(owner, `document.querySelector('#${kind}-progress').click()`);
    await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'word target dialog');
    await evaluate(owner, `(() => {const modal=document.querySelector('.modal-backdrop:not([hidden])');modal.querySelector('input').value=${JSON.stringify(value)};modal.querySelector('.m-ok').click();})()`);
    await until(() => evaluate(owner, '!document.querySelector(".modal-backdrop:not([hidden])")'), 'word target saved');
    await pause(100);
  }
  await setTarget('document', '10');
  await setTarget('manuscript', '20');
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").max'), 10);
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").value === chapterWords("ch-one")'), true);
  assert.equal(await evaluate(owner, 'document.querySelector("#manuscript-progress progress").value === bookWordCount()'), true);
  // Editing prose updates both bars; undoing restores the fixture for later tests.
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter[data-id="ch-one"] .chapter-body');body.innerHTML='<p>One two three four five six seven eight nine ten eleven twelve.</p>';body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").value'), 10);
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress").classList.contains("goal-met")'), true);
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter[data-id="ch-one"] .chapter-body');body.innerHTML='<p>First chapter prose remains intact.</p>';body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(owner, 'focusChapter("ch-two")');
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").value'), 0);
  await evaluate(owner, 'focusChapter("ch-one")');
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").max'), 10);
  check('sidebar counts removed; document and manuscript targets, live counts, switching, and completed goals work');
  // Exercise the relocated navigation against real book data before checking
  // the detached window. Reordering must preserve chapter identity and prose.
  await evaluate(owner, `document.querySelector('.tab[data-tab="outline"]').click()`);
  assert.equal(await evaluate(owner, 'currentTab'), 'outline');
  await evaluate(owner, `document.querySelector('.nav-item[data-id="ch-two"] .n-row').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
  assert.equal(await evaluate(owner, 'currentTab'), 'manuscript');
  assert.equal(await evaluate(owner, 'currentChapterId'), 'ch-two');
  await evaluate(owner, `(() => {
    const list = document.querySelector('#nav-list');

    const data = new DataTransfer(); data.setData('application/x-neo-tree', JSON.stringify({bookId:'book-test',section:'manuscript',id:'ch-two'}));
    list.querySelector('.tree-row').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
  })()`);
  await until(() => meta().chapterOrder[0] === 'ch-two', 'sidebar reorder saved');
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), 'utf8'), /First chapter prose remains intact/);
  // Restore the fixture order through the same user operation.
  await until(() => evaluate(owner, 'document.querySelector(".nav-item").dataset.id === "ch-two"'), 'reordered navigation');
  await evaluate(owner, `(() => {
    const list = document.querySelector('#nav-list');
    const data = new DataTransfer(); data.setData('application/x-neo-tree', JSON.stringify({bookId:'book-test',section:'manuscript',id:'ch-one'}));
    list.querySelector('.tree-row').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
  })()`);
  await until(() => meta().chapterOrder[0] === 'ch-one', 'order restored');
  await evaluate(owner, `document.querySelector('#workspace-nav-toggle').click()`);
  assert.equal(await evaluate(owner, 'getComputedStyle(document.querySelector("#nav-pane")).display'), 'none');
  await evaluate(owner, `document.querySelector('#workspace-nav-toggle').click(); setNavigationWidth(300, true)`);
  assert.equal(await evaluate(owner, 'JSON.parse(localStorage.getItem("neo-ai-navigation")).width'), 300);
  await evaluate(owner, 'setNavigationWidth(264, true)');
  owner.setSize(1280, 860);
  await pause(150);
  const layout = await evaluate(owner, `(() => {
    const nav = document.querySelector('#nav-pane').getBoundingClientRect();
    const paper = document.querySelector('#paper-scroll').getBoundingClientRect();
    return { navRight: nav.right, paperLeft: paper.left };
  })()`);
  assert.ok(layout.paperLeft >= layout.navRight, 'manuscript clears navigation');
  owner.setSize(900, 700);
  await evaluate(owner, 'document.querySelector("#paper-scroll").scrollTop = 0');
  await pause(150);
  fs.writeFileSync(path.join(scratch, 'workspace-small.png'), (await owner.webContents.capturePage()).toPNG());
  owner.setSize(1280, 860);
  await pause(300);
  fs.writeFileSync(path.join(scratch, 'workspace.png'), (await owner.webContents.capturePage()).toPNG());
  console.log('Workspace screenshot: ' + path.join(scratch, 'workspace.png'));
  check('sidebar chapter navigation, reorder, collapse, and device preferences');
  await evaluate(owner, 'detachOutline()');
  await until(() => !!paneWindow(), 'outline window');
  let pane = paneWindow();
  await until(() => evaluate(pane, 'typeof snapshot !== "undefined" && snapshot?.bookId === "book-test"'), 'outline snapshot');
  await evaluate(owner, 'detachOutline()');
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  check('detaching twice focuses one independent outline window');
  await until(() => evaluate(owner, '!document.querySelector("#workspace-outline-status").hidden'), 'sidebar detached indicator');
  await evaluate(owner, `document.querySelector('.tab[data-tab="outline"]').click()`);
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.equal(await evaluate(owner, 'currentTab'), 'manuscript');
  check('sidebar focuses the existing outline window');

  await evaluate(pane, `(() => {
    const field = document.querySelector('textarea[data-key]');
    field.focus(); field.value = 'Edited from detached window'; field.dispatchEvent(new Event('input'));
    return flush();
  })()`);
  assert.equal(meta().chapterNotes['ch-one'], 'Edited from detached window');
  assert.equal(await evaluate(owner, 'book.chapterNotes["ch-one"]'), 'Edited from detached window');
  check('detached edits reach the owner and disk');

  await evaluate(owner, `switchTab('outline'); (() => {
    const field = document.querySelector('.ol-text');
    field.textContent = 'Edited in main outline'; field.dispatchEvent(new Event('input'));
  })()`);
  await until(() => evaluate(pane, 'document.querySelector("textarea[data-key]").value === "Edited in main outline"'), 'main-to-pane update');
  check('main outline edits reach the detached pane');

  await evaluate(owner, 'document.querySelector(".ol-text").focus()');
  await evaluate(pane, `(() => {const field=document.querySelector('textarea[data-key]');field.value='Shared field stays current';field.dispatchEvent(new Event('input'));return flush();})()`);
  await evaluate(owner, 'document.querySelector(".ol-text").dispatchEvent(new Event("blur"))');
  assert.equal(await evaluate(owner, 'book.chapterNotes["ch-one"]'), 'Shared field stays current');
  check('an unfocused workspace field cannot restore stale text on blur');

  await evaluate(pane, 'act({ type: "addSection", chapterId: "ch-one" })');
  await until(() => evaluate(pane, 'document.querySelectorAll(".sections textarea").length === 1'), 'section creation');
  await evaluate(pane, `(() => {const field=document.querySelector('.sections textarea');field.value='A planned scene';field.dispatchEvent(new Event('input'));return flush();})()`);
  assert.equal(meta().sectionNotes['ch-one'][0].text, 'A planned scene');
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), 'utf8'), /A planned scene/);
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), 'utf8'), /First chapter prose remains intact/);
  await evaluate(pane, 'act({ type: "addChapter" })');
  assert.equal(meta().chapterOrder.length, 3);
  check('adding chapters and section notes preserves manuscript prose');

  await evaluate(pane, 'act({ type: "navigate", chapterId: "ch-two" })');
  assert.equal(await evaluate(owner, 'currentChapterId'), 'ch-two');
  assert.equal(await evaluate(owner, 'currentTab'), 'manuscript');
  check('outline selection navigates the manuscript');

  const denied = await evaluate(pane, `api.command({type:'chapterNote',bookId:'different-book',chapterId:'ch-one',text:'wrong',expected:'Edited in main outline'}).then(()=>false,()=>true)`);
  assert.equal(denied, true);
  assert.equal(meta().chapterNotes['ch-one'], 'Shared field stays current');
  assert.equal(await evaluate(pane, 'typeof window.neo'), 'undefined');
  check('wrong-book edits are rejected and detached panes have no file API');

  await evaluate(pane, `(() => {const field=document.querySelector('textarea[data-key]');field.value='Recover this draft';field.dispatchEvent(new Event('input'));clearTimeout(timer);})()`);
  await evaluate(owner, 'book.chapterNotes["ch-one"] = "Newer workspace edit"; saveMeta()');
  await evaluate(pane, 'flush().catch(() => {})');
  assert.equal(await evaluate(pane, 'blocked'), true);
  assert.equal(await evaluate(pane, 'document.querySelector("#recovery").value'), 'Recover this draft');
  assert.equal(meta().chapterNotes['ch-one'], 'Newer workspace edit');
  await evaluate(owner, 'backToShelf()');
  assert.equal(await evaluate(owner, 'book.id'), 'book-test');
  await evaluate(pane, 'document.querySelector("#discard").click()');
  await evaluate(owner, 'backToShelf()');
  await until(() => evaluate(pane, 'snapshot === null'), 'shelf state');
  check('conflicts retain drafts and prevent switching books until resolved');

  await evaluate(owner, 'openBook("book-test")');
  await until(() => evaluate(pane, 'snapshot?.bookId === "book-test"'), 'book reopened');
  await evaluate(pane, `(() => {const field=document.querySelector('textarea[data-key]');field.value='Saved when docking';field.dispatchEvent(new Event('input'));})()`);
  await evaluate(pane, 'void close(true)');
  await until(() => pane.isDestroyed(), 'redock');
  assert.equal(await evaluate(owner, 'currentTab'), 'outline');
  assert.equal(meta().chapterNotes['ch-one'], 'Saved when docking');
  check('redocking flushes pending text and restores the outline tab');

  await evaluate(owner, 'detachOutline()');
  await until(() => !!paneWindow(), 'outline reopened');
  pane = paneWindow();
  await until(() => evaluate(pane, 'typeof snapshot !== "undefined" && !!snapshot'), 'pane ready again');
  pane.setBounds({ x: 30, y: 30, width: 600, height: 650 });
  await until(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).paneWindows?.outline?.width === 600, 'saved bounds');
  // Wait for the resized native surface before requesting a screenshot.
  pane.showInactive();
  await pause(300);
  const image = await pane.webContents.capturePage();
  fs.writeFileSync(path.join(scratch, 'outline.png'), image.toPNG());
  console.log('Screenshot: ' + path.join(scratch, 'outline.png'));
  async function nameNewItem(name) {
    await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'item name dialog');
    await evaluate(owner, `(() => {
      const modal = document.querySelector('.modal-backdrop:not([hidden])');
      modal.querySelector('input').value = ${JSON.stringify(name)}; modal.querySelector('.m-ok').click();
    })()`);
    await until(() => evaluate(owner, `!!workspaceSelection && WorkspaceTree.find(book.workspaceTree[workspaceSelection.section], workspaceSelection.id)?.node.title === ${JSON.stringify(name)}`), 'new item selected');
    return evaluate(owner, 'workspaceSelection.id');
  }
  await evaluate(owner, `document.querySelector('.workspace-root[data-section="manuscript"] .tree-toggle').click()`);
  assert.equal(await evaluate(owner, 'document.querySelector("#nav-list").hidden'), true);
  await evaluate(owner, `document.querySelector('.workspace-root[data-section="manuscript"] .tree-toggle').click(); document.querySelector('.workspace-root[data-section="manuscript"] .tree-menu').click(); document.querySelector('.workspace-add-menu button').click()`);
  const actId = await nameNewItem('Act One');
  await evaluate(owner, `document.querySelector('.workspace-node[data-id="${actId}"] > .tree-row .tree-menu').click(); document.querySelector('.workspace-add-menu button').click()`);
  const chapterFolder = await nameNewItem('Chapter folder');
  // Add a manuscript document inside a nested folder using its visible button.
  await evaluate(owner, `document.querySelector('.workspace-node[data-id="${chapterFolder}"] > .tree-row .tree-menu').click(); document.querySelectorAll('.workspace-add-menu button')[1].click()`);
  await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'document dialog');
  await evaluate(owner, `(() => {const modal=document.querySelector('.modal-backdrop:not([hidden])');modal.querySelector('input').value='New scene';modal.querySelector('.m-ok').click();})()`);
  await until(() => evaluate(owner, 'book.chapterTitles[currentChapterId] === "New scene"'), 'new manuscript document');
  const sceneId = await evaluate(owner, 'currentChapterId');
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter[data-id="${sceneId}"] .chapter-body');body.innerHTML='<p>A new scene inside a chapter folder.</p>';body.dispatchEvent(new Event('input', {bubbles:true}));})()`);
  await evaluate(owner, 'flushAllSaves()');
  assert.ok(fs.existsSync(path.join(bookDir, 'chapters', sceneId + '.html')));
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', sceneId + '.html'), 'utf8'), /A new scene inside a chapter folder/);
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').node.children[0].id`), sceneId);
  assert.equal(await evaluate(owner, '[...document.querySelectorAll(".chapter-head")].every(head => head.hidden)'), true);
  assert.equal(await evaluate(owner, 'exportChapters().every(section => section.heading === "")'), true);
  assert.match(await evaluate(owner, 'document.querySelector("#workspace-section-label").textContent'), /Act One \/ Chapter folder \/ New scene/);
  // Create at the section root while a nested document is selected.
  await evaluate(owner, `document.querySelector('.workspace-root[data-section="manuscript"] .tree-menu').click(); document.querySelector('.workspace-add-menu button').click()`);
  const otherFolder = await nameNewItem('Another chapter');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${otherFolder}').parentId`), null);
  // Use real browser mouse input, rather than dispatching only a synthetic drop.
  owner.webContents.debugger.attach('1.3');
  async function dragTreeNode(sourceId, targetSelector, ratio, expectedPosition, handle = '.tree-node-link') {
    const points = await evaluate(owner, `(() => {
      const source=document.querySelector('.workspace-node[data-id="${sourceId}"] > .tree-row ${handle}');
      const target=document.querySelector(${JSON.stringify(targetSelector)});
      source.scrollIntoView({block:'center'});
      const s=source.getBoundingClientRect(), t=target.getBoundingClientRect();
      return {sx:s.left+Math.min(30,s.width/2),sy:s.top+s.height/2,tx:t.left+Math.min(50,t.width/2),ty:t.top+t.height*${ratio}};
    })()`);
    const mouse = args => owner.webContents.debugger.sendCommand('Input.dispatchMouseEvent', args);
    await mouse({type:'mousePressed',x:points.sx,y:points.sy,button:'left',buttons:1,clickCount:1});
    await mouse({type:'mouseMoved',x:points.sx+12,y:points.sy,button:'left',buttons:1});
    const destination = await evaluate(owner, `(() => {const target=document.querySelector(${JSON.stringify(targetSelector)});target.scrollIntoView({block:'center'});const r=target.getBoundingClientRect();return {x:r.left+Math.min(50,r.width/2),y:r.top+r.height*${ratio}};})()`);
    points.tx = destination.x; points.ty = destination.y;
    await mouse({type:'mouseMoved',x:points.tx,y:points.ty,button:'left',buttons:1});
    assert.equal(await evaluate(owner, 'treeDragging'), true);
    assert.equal(await evaluate(owner, 'document.querySelectorAll(".tree-drag-source").length'), 1);
    assert.equal(await evaluate(owner, `document.querySelector(${JSON.stringify(targetSelector)}).dataset.treeDrop`), expectedPosition,
      targetSelector + ': ' + await evaluate(owner, `JSON.stringify({hint:treeDragHint.textContent,x:treePointer.x,y:treePointer.y,hit:document.elementFromPoint(treePointer.x,treePointer.y)?.outerHTML.slice(0,160)})`));
    await mouse({type:'mouseReleased',x:points.tx,y:points.ty,button:'left',buttons:0,clickCount:1});
    await until(() => evaluate(owner, '!treeDragging && !treeMoveBusy'), 'pointer move saved');
    await pause(100);
  }
  await dragTreeNode(sceneId, `.workspace-node[data-id="${otherFolder}"] > .tree-row`, 0.5, 'inside', '.tree-drag-grip');
  await until(() => evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${sceneId}').parentId === '${otherFolder}'`), 'scene moved between folders');
  await dragTreeNode(otherFolder, `.workspace-node[data-id="${actId}"] > .tree-row`, 0.1, 'before');
  assert.equal(await evaluate(owner, `book.workspaceTree.manuscript.findIndex(n=>n.id==='${otherFolder}') < book.workspaceTree.manuscript.findIndex(n=>n.id==='${actId}')`), true);
  await dragTreeNode(otherFolder, `.workspace-node[data-id="${actId}"] > .tree-row`, 0.9, 'after');
  assert.equal(await evaluate(owner, `book.workspaceTree.manuscript.findIndex(n=>n.id==='${otherFolder}') > book.workspaceTree.manuscript.findIndex(n=>n.id==='${actId}')`), true);
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${otherFolder}').parentId`), null);
  await dragTreeNode(sceneId, `.workspace-node[data-id="${chapterFolder}"] > .tree-row`, 0.5, 'inside');
  await dragTreeNode(chapterFolder, '.workspace-root[data-section="manuscript"]', 0.5, 'inside');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').parentId`), null);
  await dragTreeNode(chapterFolder, `.workspace-node[data-id="${actId}"] > .tree-row`, 0.5, 'inside');
  owner.webContents.debugger.detach();
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').parentId`), actId);
  check('real pointer dragging moves scenes and folder subtrees, reorders root folders, and restores nesting without auto headings');
  await evaluate(owner, `moveWorkspaceItem('manuscript', 'ch-two', '${chapterFolder}', '${sceneId}')`);
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-two.html'), 'utf8'), /Second chapter prose remains intact/);
  await evaluate(owner, `structuralUndo()`);
  assert.equal(await evaluate(owner, 'book.workspaceTree.manuscript.some(n => n.id === "ch-two")'), true);
  const references = {};
  for (const section of ['characters', 'locations', 'worldbuilding']) {
    await evaluate(owner, `document.querySelector('.workspace-root[data-section="${section}"] .tree-menu').click(); document.querySelector('.workspace-add-menu button').click()`);
    const folderId = await nameNewItem(section + ' folder');
    await evaluate(owner, `document.querySelector('.workspace-node[data-id="${folderId}"] > .tree-row .tree-menu').click(); document.querySelectorAll('.workspace-add-menu button')[1].click()`);
    references[section] = await nameNewItem(section + ' document');
    await evaluate(owner, `(() => { const field = document.querySelector('.tree-document-text'); field.textContent = 'Saved ${section} content'; field.dispatchEvent(new Event('input')); })()`);
    assert.equal(await evaluate(owner, 'document.querySelector("#document-progress .word-progress-count").textContent'), '3 words');
  }
  await evaluate(owner, 'backToShelf()');
  await evaluate(owner, 'openBook("book-test")');
  for (const [section, id] of Object.entries(references)) {
    await evaluate(owner, `openWorkspaceNode('${section}', '${id}')`);
    assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text").textContent'), 'Saved ' + section + ' content');
  }
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').node.children[0].id`), sceneId);
  await evaluate(owner, `openWorkspaceNode('manuscript', '${actId}')`);
  owner.setSize(1500, 1050);
  await owner.webContents.capturePage();
  await pause(600);
  fs.writeFileSync(path.join(scratch, 'workspace-tree.png'), (await owner.webContents.capturePage()).toPNG());
  console.log('Tree screenshot: ' + path.join(scratch, 'workspace-tree.png'));
  await evaluate(owner, 'switchTab("manuscript")');
  await evaluate(owner, 'focusChapter("ch-one")');
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").max'), 10);
  assert.equal(await evaluate(owner, 'document.querySelector("#manuscript-progress progress").max'), 20);
  check('root collapse, nested folder/document creation, move undo, and reference text survive reopening');
  // Every heading is a folder/document destination, including the tool sections.
  for (const section of ['outline', 'research', 'notes', 'darlings', 'ai-assistance']) {
    await evaluate(owner, `document.querySelector('.workspace-root[data-section="${section}"] .tree-menu').click()`);
    assert.deepEqual(await evaluate(owner, '[...document.querySelectorAll(".workspace-add-menu button")].map(b=>b.textContent)'), ['New folder', 'New document']);
    await evaluate(owner, 'closeTreeMenu()');
  }
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter[data-id="ch-one"] .chapter-body');body.innerHTML='<p>First <em>chapter</em> prose remains intact.</p>';body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  owner.webContents.debugger.attach('1.3');
  await dragTreeNode('ch-one', '.workspace-root[data-section="darlings"]', 0.5, 'inside', '.tree-drag-grip');
  assert.equal(await evaluate(owner, 'book.chapterOrder.includes("ch-one")'), false);
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text em").textContent'), 'chapter');
  assert.equal(await evaluate(owner, 'document.querySelector("#document-progress progress").max'), 10);
  // Edits while parked in Darlings must survive moving the same document back.
  await evaluate(owner, `(() => {const body=document.querySelector('.tree-document-text');body.innerHTML+='<p><strong>Revision kept.</strong></p>';body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(owner, 'structuralUndo()');
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), 'utf8'), /<strong>Revision kept\.<\/strong>/);
  assert.equal(await evaluate(owner, 'book.chapterOrder[0]'), 'ch-one');
  let sourceSection = 'manuscript';
  for (const section of ['characters', 'locations', 'worldbuilding', 'research', 'notes', 'outline', 'ai-assistance', 'darlings', 'manuscript']) {
    await dragTreeNode(actId, `.workspace-root[data-section="${section}"]`, 0.5, 'inside');
    assert.equal(await evaluate(owner, `!!WorkspaceTree.find(book.workspaceTree['${sourceSection}'], '${actId}')`), false);
    assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree['${section}'], '${sceneId}').parentId`), chapterFolder);
    sourceSection = section;
  }
  owner.webContents.debugger.detach();
  // Native plain-text reference documents gain safe HTML when moved to Manuscript.
  await evaluate(owner, `moveWorkspaceItem('characters', '${references.characters}', null, null, 'manuscript')`);
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', references.characters + '.html'), 'utf8'), /Saved characters content/);
  await evaluate(owner, 'structuralUndo()');
  assert.equal(await evaluate(owner, `!!WorkspaceTree.find(book.workspaceTree.characters, '${references.characters}')`), true);
  // A failed catalog write leaves the source tree and its content in place.
  assert.equal(await evaluate(owner, `(async () => {const save=saveMeta;try {saveMeta=async()=>{if(!book.chapterOrder.includes('ch-one')) throw new Error('Simulated write failure');return save()};try {await moveWorkspaceItem('manuscript','ch-one',null,null,'darlings')}catch(error){return error.message}}finally{saveMeta=save}})()`), 'Simulated write failure');
  assert.equal(await evaluate(owner, 'book.chapterOrder.includes("ch-one") && !WorkspaceTree.find(book.workspaceTree.darlings,"ch-one")'), true);
  await evaluate(owner, `moveWorkspaceItem('manuscript', 'ch-one', null, null, 'darlings')`);
  await evaluate(owner, 'backToShelf();');
  await evaluate(owner, 'openBook("book-test")');
  assert.equal(await evaluate(owner, 'book.chapterOrder.includes("ch-one")'), false);
  assert.match(await evaluate(owner, 'WorkspaceTree.find(book.workspaceTree.darlings,"ch-one").node.html'), /Revision kept/);
  await evaluate(owner, `moveWorkspaceItem('darlings', 'ch-one', null, 'ch-two', 'manuscript')`);
  // Restore the fixture text for the remaining deletion tests.
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter[data-id="ch-one"] .chapter-body');body.innerHTML='<p>First chapter prose remains intact.</p>';body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  check('cross-section mouse moves, all destinations, Darlings round trip, formatting, undo, failure recovery and reopen persistence');
  async function menuFor(id, expected) {
    await evaluate(owner, `document.querySelector('.workspace-node[data-id="${id}"] > .tree-row .tree-menu').click()`);
    expected = expected.flatMap(label => label === 'Delete' ? ['Use as AI context', 'Delete'] : [label]);
    assert.deepEqual(await evaluate(owner, '[...document.querySelectorAll(".workspace-add-menu button")].map(button => button.textContent)'), expected);
  }
  async function submitRename(name) {
    await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'rename dialog');
    await evaluate(owner, `(() => { const modal=document.querySelector('.modal-backdrop:not([hidden])'); modal.querySelector('input').value=${JSON.stringify(name)}; modal.querySelector('.m-ok').click(); })()`);
  }
  await evaluate(owner, `document.querySelector('.workspace-root[data-section="manuscript"] .tree-menu').click()`);
  assert.deepEqual(await evaluate(owner, '[...document.querySelectorAll(".workspace-add-menu button")].map(button => button.textContent)'), ['New folder', 'New document']);
  await evaluate(owner, 'closeTreeMenu()');
  await menuFor(actId, ['New folder', 'New document', 'Edit', 'Delete']);
  await evaluate(owner, 'document.querySelectorAll(".workspace-add-menu button")[2].click()');
  await submitRename('Renamed act');
  await until(() => meta().workspaceTree.manuscript.some(node => node.id === actId && node.title === 'Renamed act'), 'folder rename saved');
  await evaluate(owner, `(() => {
    const link=document.querySelector('.workspace-node[data-id="${chapterFolder}"] > .tree-row .tree-node-link');
    link.click(); link.click();
    if (!link.isConnected) throw new Error('Opening folder broke double-click target');
    link.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  })()`);
  await submitRename('Renamed chapter folder');
  await until(() => evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').node.title === 'Renamed chapter folder'`), 'double click rename');
  await menuFor(sceneId, ['Edit', 'Delete']);
  await evaluate(owner, 'document.querySelector(".workspace-add-menu button").click()');
  await submitRename('Renamed scene');
  await until(() => meta().chapterTitles[sceneId] === 'Renamed scene', 'document rename saved');
  async function confirmDelete(id, expectedMenu, confirm = true) {
    await menuFor(id, expectedMenu);
    await evaluate(owner, 'document.querySelector(".workspace-add-menu button:last-child").click()');
    await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) .fr-choice")'), 'delete confirmation');
    await evaluate(owner, `document.querySelector('.modal-backdrop:not([hidden]) ${confirm ? '.fr-choice' : '.m-cancel'}').click()`);
  }
  await confirmDelete(actId, ['New folder', 'New document', 'Edit', 'Delete'], false);
  assert.ok(await evaluate(owner, `!!WorkspaceTree.find(book.workspaceTree.manuscript, '${actId}')`));
  await confirmDelete(actId, ['New folder', 'New document', 'Edit', 'Delete']);
  await until(() => !meta().chapterOrder.includes(sceneId) && !fs.existsSync(path.join(bookDir, 'chapters', sceneId + '.html')), 'subtree removed from metadata and disk');
  assert.ok(await evaluate(owner, 'darlings.some(d => d.html.includes("A new scene inside a chapter folder"))'));
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', 'ch-one.html'), 'utf8'), /First chapter prose remains intact/);
  await evaluate(owner, 'structuralUndo()');
  assert.ok(meta().chapterOrder.includes(sceneId));
  assert.match(fs.readFileSync(path.join(bookDir, 'chapters', sceneId + '.html'), 'utf8'), /A new scene inside a chapter folder/);
  await confirmDelete(references.characters, ['Edit', 'Delete']);
  await until(() => evaluate(owner, `!WorkspaceTree.find(book.workspaceTree.characters, '${references.characters}')`), 'reference document deleted');
  await evaluate(owner, 'structuralUndo()');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.characters, '${references.characters}').node.text`), 'Saved characters content');
  // A nested folder created from a menu must follow that menu's parent,
  // even when a different section is selected in the editor.
  await evaluate(owner, `switchTab('locations')`);
  await menuFor(chapterFolder, ['New folder', 'New document', 'Edit', 'Delete']);
  await evaluate(owner, 'document.querySelector(".workspace-add-menu button").click()');
  const deeperFolder = await nameNewItem('Nested under menu parent');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript, '${chapterFolder}').node.children.some(n => n.id === '${deeperFolder}')`), true);
  await evaluate(owner, 'backToShelf()');
  await evaluate(owner, 'openBook("book-test")');
  assert.equal(meta().chapterTitles[sceneId], 'Renamed scene');
  await menuFor(chapterFolder, ['New folder', 'New document', 'Edit', 'Delete']);
  await pause(200);
  fs.writeFileSync(path.join(scratch, 'workspace-menu.png'), (await owner.webContents.capturePage()).toPNG());
  console.log('Menu screenshot: ' + path.join(scratch, 'workspace-menu.png'));
  await evaluate(owner, 'closeTreeMenu()');
  check('exact menus, double-click rename, nested creation, cancel/delete, text recovery and undo');
  async function contextMenu(section, id) {
    await evaluate(owner, `closeTreeMenu();document.querySelector('.workspace-tree[data-section="${section}"] .workspace-node[data-id="${id}"] > .tree-row .tree-menu').click()`);
    return evaluate(owner, `(() => {const toggle=document.querySelector('[role="menuitemcheckbox"]');return {checked:toggle.getAttribute('aria-checked'),disabled:toggle.disabled};})()`);
  }
  async function toggleContext(section, id, expected) {
    await contextMenu(section,id);
    await evaluate(owner, 'document.querySelector("[role=menuitemcheckbox]").click()');
    await until(() => evaluate(owner, `WorkspaceTree.find(book.workspaceTree['${section}'],'${id}').node.aiContext === ${expected}`), 'AI context toggled');
    await evaluate(owner, 'flushAllSaves()');
  }
  assert.deepEqual(await contextMenu('manuscript',sceneId), {checked:'true',disabled:false});
  await toggleContext('manuscript',sceneId,false);
  await toggleContext('manuscript',actId,false);
  assert.deepEqual(await contextMenu('manuscript',sceneId), {checked:'false',disabled:true});
  assert.match(await evaluate(owner, 'document.querySelector(".tree-context-reason").textContent'), /Excluded by folder/);
  await evaluate(owner, 'closeTreeMenu()');
  assert.equal(await evaluate(owner, `WorkspaceTree.contextDocuments(book.workspaceTree).some(item=>item.id==='${sceneId}')`),false);
  await toggleContext('manuscript',actId,true);
  assert.deepEqual(await contextMenu('manuscript',sceneId), {checked:'false',disabled:false});
  await evaluate(owner, 'closeTreeMenu()');
  await evaluate(owner, `moveWorkspaceItem('manuscript','${actId}',null,null,'darlings')`);
  assert.deepEqual(await contextMenu('darlings',actId), {checked:'false',disabled:true});
  await evaluate(owner, 'closeTreeMenu();structuralUndo()');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree.manuscript,'${sceneId}').node.aiContext`),false);
  await toggleContext('manuscript','ch-one',false);
  const liveCoverContext = await evaluate(owner, 'coverContextText(book)');
  assert.doesNotMatch(liveCoverContext,/First chapter prose/);
  assert.match(liveCoverContext,/Second chapter prose/);
  await evaluate(owner, 'backToShelf()');
  const shelfCoverContext = await evaluate(owner, 'coverContextText({id:"book-test"})');
  assert.doesNotMatch(shelfCoverContext,/First chapter prose/);
  assert.match(shelfCoverContext,/Second chapter prose/);
  await evaluate(owner, 'openBook("book-test")');
  assert.deepEqual(await contextMenu('manuscript','ch-one'), {checked:'false',disabled:false});
  assert.deepEqual(await contextMenu('manuscript',sceneId), {checked:'false',disabled:false});
  await owner.webContents.capturePage();
  await pause(200);
  fs.writeFileSync(path.join(scratch,'context-menu.png'),(await owner.webContents.capturePage()).toPNG());
  await evaluate(owner,'closeTreeMenu()');
  check('AI context menu state, folder exclusion, Darlings exclusion, moves, reopen persistence and cover context filtering');
  // Exercise the actual File menu path with dialogs and process exit stubbed.
  // A portable restart must retain the selected library and flush its panes.
  const nextLibrary = path.join(scratch, 'another-library');
  fs.mkdirSync(nextLibrary);
  const originalMessageBox = dialog.showMessageBox;
  const originalOpenDialog = dialog.showOpenDialog;
  const originalRelaunch = app.relaunch;
  const originalExit = app.exit;
  const originalPortable = process.env.PORTABLE_EXECUTABLE_FILE;
  let relaunch;
  let exitCode;
  try {
    process.env.PORTABLE_EXECUTABLE_FILE = path.join(scratch, 'Neo-AI portable.exe');
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextLibrary] });
    app.relaunch = (options) => { relaunch = options; };
    app.exit = (code) => { exitCode = code; };
    await evaluate(pane, `(() => {const field=document.querySelector('textarea[data-key]');field.value='Saved before changing library';field.dispatchEvent(new Event('input'));})()`);
    const fileMenu = Menu.getApplicationMenu().items.find((item) => item.label === 'File');
    fileMenu.submenu.items.find((item) => item.label === 'Library and Backups…').click();
    let settingsWindow;
    await until(() => { settingsWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html')); return settingsWindow; }, 'library settings');
    await until(() => evaluate(settingsWindow, 'typeof loaded !== "undefined" && loaded && !document.querySelector("#general").hidden'), 'general settings ready');
    await evaluate(settingsWindow, 'document.querySelector("#browse-library").click()');
    await until(() => exitCode === 0, 'library restart requested');
    assert.equal(meta().chapterNotes['ch-one'], 'Saved before changing library');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).libraryDir, nextLibrary);
    if (process.platform === 'win32') assert.equal(relaunch.execPath, process.env.PORTABLE_EXECUTABLE_FILE);
    else assert.deepEqual(relaunch, {});
    check('library selection saves pending edits and restarts through the correct executable');
  } finally {
    dialog.showMessageBox = originalMessageBox;
    dialog.showOpenDialog = originalOpenDialog;
    app.relaunch = originalRelaunch;
    app.exit = originalExit;
    if (originalPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
    else process.env.PORTABLE_EXECUTABLE_FILE = originalPortable;
  }
  await evaluate(pane, `(() => {const field=document.querySelector('textarea[data-key]');field.value='Saved when workspace closes';field.dispatchEvent(new Event('input'));})()`);
  app.removeAllListeners('window-all-closed');
  owner.close();
  await until(() => owner.isDestroyed(), 'workspace close');
  assert.equal(pane.isDestroyed(), true);
  assert.equal(meta().chapterNotes['ch-one'], 'Saved when workspace closes');
  assert.deepEqual(rendererErrors, []);
  check('closing the workspace saves pane edits and closes all windows');
  console.log('PASS: real Electron integration tests complete. Temporary fixtures: ' + scratch);
  app.exit(0);
}).catch((error) => { console.error(error); console.error('Fixtures: ' + scratch); app.exit(1); });

setTimeout(() => { console.error('Integration test exceeded 90 seconds'); app.exit(1); }, 90000).unref();
