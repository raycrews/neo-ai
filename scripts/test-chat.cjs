// Real Electron chat UI, isolated library/device data and a local mock provider.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-chat-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(libraryDir);
for (const id of ['book-one', 'book-two']) {
  fs.mkdirSync(path.join(libraryDir, id, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(libraryDir, id, 'book.json'), JSON.stringify({ id, title: id, author: 'Fixture', chapterOrder: ['ch-one'] }));
  fs.writeFileSync(path.join(libraryDir, id, 'chapters/ch-one.html'), '<p>Private manuscript fixture must never be sent.</p>');
}
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir }));
fs.writeFileSync(path.join(device, 'ai-assistants.json'), JSON.stringify({ version: 1, instructions: { characters: 'Explore the character’s motivations. Fixture purpose instructions.' } }));
fs.writeFileSync(path.join(libraryDir, 'book-two', 'ai-chats.json'), JSON.stringify({version:1,selectedId:'legacy-chat',conversations:[{id:'legacy-chat',title:'Previously saved chat',profileId:'local',model:'fixture-model',draft:'',messages:[],summary:null,preview:null}]}));
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({ firstRunDone: true, authorName: 'Fixture', hintShown: true, coverArt: { auto: false }, shelves: [{ id: 'shelf-one', name: 'Shelf', bookIds: ['book-one', 'book-two'] }] }));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS = '1';
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
const requests = []; let slow = false, bad = false, formattedReply = false;
const markdownReply = '### Established Facts\n\n**Sarah** has an *uncertain* past.\n\n1. **Motivation**\n   - A nested detail\n2. A second option\n\n> A quoted idea\n\n---\n\n`literal code`\n\n<script>globalThis.markdownExecuted=true</script>\n\n![Image](https://example.com/tracker.png)';
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null; requests.push({ url: req.url, body });
  if (req.url === '/api/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ models: [{ type: 'llm', key: 'fixture-model', max_context_length: 131072, loaded_instances: [{id: 'fixture-model', config: {context_length: 8192}}, {id: 'other-model', config: {context_length: 16384}}] }] })); }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'other-model' }] })); }
  if (bad) { res.writeHead(401); return res.end('private server error'); }
  res.setHeader('Content-Type', 'text/event-stream');
  const responses = req.url === '/v1/responses';
  const compact = JSON.stringify(body).includes('Return only the summary.');
  const fragments = compact ? ['Author chose a mystery. ', 'The seaside setting remains a proposal.'] : formattedReply ? [markdownReply.slice(0, 30), markdownReply.slice(30)] : ['Consider a seaside ', 'mystery with a missing diary.'];
  const chunk = text => res.write('data: ' + JSON.stringify(responses ? { type: 'response.output_text.delta', delta: text } : { choices: [{ delta: { content: text } }] }) + '\n\n');
  chunk(fragments[0]);
  if (slow) return;
  setTimeout(() => { chunk(fragments[1]); res.end(responses ? 'data: {"type":"response.completed"}\n\n' : 'data: [DONE]\n\n'); }, 160);
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(device, 'ai-connections.json'), JSON.stringify({ version: 1, defaultId: 'local', profiles: [
  { id: 'local', name: 'Local fixture', provider: 'lmstudio', api: 'chat', model: 'fixture-model', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' },
  { id: 'responses', name: 'Responses fixture', provider: 'compatible', api: 'responses', model: 'fixture-model', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' }
] })));
const errors = [];
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
require('../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true).catch(error => { throw new Error(code.slice(0, 300) + '\n' + error.message); });
async function until(fn, label) { const limit = Date.now() + 16000; while (Date.now() < limit) { if (await fn()) return; await pause(40); } throw new Error('Timed out: ' + label); }
const ownerWindow = () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
const paneWindow = () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/ai-pane.html'));
const chatData = () => JSON.parse(fs.readFileSync(path.join(libraryDir, 'book-one', 'ai-chats.json'), 'utf8'));
app.whenReady().then(async () => {
  await until(() => ownerWindow(), 'owner'); const owner = ownerWindow(); owner.setSize(1400, 1000); owner.webContents.setBackgroundThrottling(false);
  await until(() => evaluate(owner, '!!window.neoChatView && typeof library !== "undefined" && !!library'), 'startup');
  await evaluate(owner, 'openBook("book-one")');
  await evaluate(owner, 'switchTab("ai-assistance")');
  await until(() => evaluate(owner, '!!window.neoChatView.current()'), 'chat loaded');
  assert.equal(await evaluate(owner, 'window.neoChatView.root.hidden'), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.assistant.value'), 'general');
  await evaluate(owner, 'window.neoChatView.assistant.value="characters"; window.neoChatView.assistant.dispatchEvent(new Event("change"));');
  await until(() => evaluate(owner, 'window.neoChatView.current().assistantType === "characters" && !window.neoChatView.requestBusy'), 'assistant type saved');
  assert.equal(await evaluate(owner, 'document.querySelector("#editor-view").hidden'), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.exportButton.disabled'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.compact.nextElementSibling === window.neoChatView.exportButton'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.contextButton.nextElementSibling === window.neoChatView.budgetView.detailsButton'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.details.contains(window.neoChatView.budgetView.meter)'), true);
  assert.equal(await evaluate(owner, '!!document.querySelector(".ai-chat-header")'), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.connectionNotice.hidden'), true);
  await until(() => evaluate(owner, '!!window.neoChatView.budgetView.report'), 'initial estimate');
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.report.capacity.limit'), null);
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.meter.hidden'), true);
  assert.equal(requests.length, 0);
  assert.equal(await evaluate(owner, 'window.neoChatView.model.hidden'), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.model.tagName'), 'SELECT');
  assert.equal(await evaluate(owner, 'window.neoChatView.model.previousElementSibling === window.neoChatView.connection && window.neoChatView.model.nextElementSibling === window.neoChatView.discover'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.controls.querySelectorAll(":scope > select").length'), 0);
  assert.equal(await evaluate(owner, 'window.neoChatView.model.value'), 'fixture-model');
  await evaluate(owner, 'window.neoChatView.discover.click()');
  await until(() => evaluate(owner, 'window.neoChatView.model.options.length === 4'), 'model list');
  assert.equal(await evaluate(owner, 'window.neoChatView.model.options.length'), 4);
  await evaluate(owner, 'window.neoChatView.model.value="other-model";window.neoChatView.model.dispatchEvent(new Event("change"))');
  await until(() => evaluate(owner, 'window.neoChatView.current().model === "other-model" && !window.neoChatView.requestBusy'), 'model saved');
  await evaluate(owner, 'window.neoChatView.model.selectedIndex=window.neoChatView.model.options.length-1;window.neoChatView.model.dispatchEvent(new Event("change"))');
  assert.equal(await evaluate(owner, 'window.neoChatView.modelDialog.open'), true);
  await evaluate(owner, 'window.neoChatView.manualModel.value="custom-model";window.neoChatView.modelDialog.querySelector("form").requestSubmit()');
  await until(() => evaluate(owner, 'window.neoChatView.current().model === "custom-model" && !window.neoChatView.requestBusy'), 'manual model saved');
  assert.equal(await evaluate(owner, 'window.neoChatView.model.value'), 'custom-model');
  await evaluate(owner, 'window.neoChatView.model.selectedIndex=window.neoChatView.model.options.length-1;window.neoChatView.model.dispatchEvent(new Event("change"));window.neoChatView.manualModel.value="discard-model";window.neoChatView.modelDialog.querySelector("button").click()');
  assert.equal(await evaluate(owner, 'window.neoChatView.current().model'), 'custom-model');
  await evaluate(owner, 'window.neoChatView.model.value="other-model";window.neoChatView.model.dispatchEvent(new Event("change"))');
  await until(() => evaluate(owner, 'window.neoChatView.current().model === "other-model" && !window.neoChatView.requestBusy'), 'return to discovered model');

  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.capacity.limit === 16384'), 'loaded model context limit');
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.report.capacity.source'), 'loaded');
  const beforeBudget = requests.length;
  await evaluate(owner, 'window.neoChatView.budgetView.limit.value="8192";window.neoChatView.budgetView.save.click()');
  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.capacity.source === "manual" && window.neoChatView.budgetView.report.capacity.limit === 8192'), 'manual model limit');
  await evaluate(owner, 'window.neoChatView.draft.value="x".repeat(20000);window.neoChatView.draft.dispatchEvent(new Event("input"))');
  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.current.parts.draft === 5000'), 'live draft estimate');
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.root.classList.contains("ai-budget-warning")'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.current().summary'), null);
  assert.equal(requests.length, beforeBudget); // Neither estimating nor crossing a limit compacts or sends.
  await evaluate(owner, 'window.neoChatView.draft.value="";window.neoChatView.draft.dispatchEvent(new Event("input"))');
  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.current.parts.draft === 0'), 'draft cleared estimate');
  console.log('PASS: discovered loaded context, manual override, live draft budget, no automatic compaction or provider traffic');
  const savedConnectionsPath = path.join(device, 'ai-connections.json');
  const savedConnections = JSON.parse(fs.readFileSync(savedConnectionsPath));
  savedConnections.profiles.find(p=>p.id==='local').responseSettings = [{model:'other-model',maxReplyTokens:1536,temperature:0.6}];
  fs.writeFileSync(savedConnectionsPath, JSON.stringify(savedConnections));
  await evaluate(owner, 'window.neoChatView.refreshConnections()');
  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.current.reply === 1536'), 'saved reply limit in live context budget');

  async function send(win, message) {
    await evaluate(win, `(() => {const v=${win === owner ? 'window.neoChatView' : 'view'};v.draft.value=${JSON.stringify(message)};v.draft.dispatchEvent(new Event('input'));return v.send()})()`);
  }
  async function enter(win, modifiers = 0) {
    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers, text: '\r', unmodifiedText: '\r' });
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers });
    } finally { win.webContents.debugger.detach(); }
  }
  async function keyboardSend(win, message, modifiers = 0) {
    const binding = win === owner ? 'window.neoChatView' : 'view';
    await evaluate(win, `(() => {const v=${binding};v.draft.value=${JSON.stringify(message)};v.draft.focus();v.draft.setSelectionRange(v.draft.value.length,v.draft.value.length);v.draft.dispatchEvent(new Event('input'));})()`);
    // Composing Enter accepts IME text; a held key must not send another turn.
    assert.equal(await evaluate(win, `${binding}.draft.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`), true);
    assert.equal(await evaluate(win, `${binding}.draft.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}))`), false);
    await enter(win, 8);
    assert.equal(await evaluate(win, `${binding}.draft.value.endsWith(String.fromCharCode(10))`), true);
    assert.equal(await evaluate(win, `${binding}.current().messages.some(m=>m.role==='user' && m.content===${JSON.stringify(message)})`), false);
    await enter(win, modifiers);
    await until(() => evaluate(win, `${binding}.current().messages.some(m=>m.role==='user' && m.content===${JSON.stringify(message)})`), 'Enter sends message');
    await until(() => ready(win), 'keyboard reply');
  }
  const ready = win => evaluate(win, `!${win === owner ? 'window.neoChatView' : 'view'}.state.job`);
  await keyboardSend(owner, 'Brainstorm a mystery');
  await until(() => ready(owner), 'first reply');
  assert.match(requests.at(-1).body.messages[0].content, /Fixture purpose instructions/);
  assert.equal(chatData().conversations[0].messages.length, 2);
  assert.equal(requests.at(-1).body.model, 'other-model');
  assert.equal(requests.at(-1).body.max_tokens, 1536);
  assert.equal(requests.at(-1).body.temperature, 0.6);
  assert.ok(!JSON.stringify(requests).includes('Private manuscript fixture'));
  const firstId = await evaluate(owner, 'window.neoChatView.current().id');
  assert.equal(await evaluate(owner, 'workspaceChatNodes().some(item=>item.node.conversationId === window.neoChatView.current().id)'), true);
  await evaluate(owner, 'window.neoChatView.draft.value="Keep this draft in the first chat";window.neoChatView.draft.dispatchEvent(new Event("input"));window.neoChatView.newButton.click()');
  await until(() => evaluate(owner, 'window.neoChatView.state.conversations.length === 2 && !window.neoChatView.requestBusy'), 'new conversation');
  await evaluate(owner, `window.neoChatView.conversation.value=${JSON.stringify(firstId)};window.neoChatView.conversation.dispatchEvent(new Event('change'))`);
  await until(() => evaluate(owner, `window.neoChatView.current().id === ${JSON.stringify(firstId)} && !window.neoChatView.requestBusy`), 'select saved conversation');
  assert.equal(await evaluate(owner, 'window.neoChatView.draft.value'), 'Keep this draft in the first chat');
  // Click sidebar entries rather than relying on the conversation dropdown.
  const secondId = await evaluate(owner, 'window.neoChatView.state.conversations[1].id');
  async function openChatNode(id) {
    await evaluate(owner, `document.querySelector('.workspace-node[data-id="chat-${id}"] .tree-node-link').click()`);
    await until(() => evaluate(owner, `window.neoChatView.current()?.id === ${JSON.stringify(id)} && !window.neoChatView.requestBusy`), 'sidebar chat selected');
    assert.equal(await evaluate(owner, 'window.neoChatView.root.hidden'), false);
  }
  await openChatNode(secondId);
  assert.equal(await evaluate(owner, 'window.neoChatView.current().messages.length'), 0);
  await openChatNode(firstId);
  assert.equal(await evaluate(owner, 'window.neoChatView.draft.value'), 'Keep this draft in the first chat');
  await keyboardSend(owner, 'Make it personal', process.platform === 'darwin' ? 4 : 2);
  assert.equal(owner.isFullScreen(), false);
  for (const message of ['Choose a mystery', 'What happens next?']) { await send(owner, message); await until(() => ready(owner), message); }
  const original = structuredClone(chatData().conversations[0].messages);
  await evaluate(owner, 'window.neoChatView.compact.click()');
  await until(() => evaluate(owner, 'window.neoChatView.current().preview?.status === "complete"'), 'summary');
  await until(() => evaluate(owner, '!!window.neoChatView.budgetView.report?.proposed'), 'compaction comparison');
  assert.equal(await evaluate(owner, 'window.neoChatView.budgetView.report.proposed.recentMessages'), 4);
  const oldPreviewTokens = await evaluate(owner, 'window.neoChatView.budgetView.report.proposed.parts.summary');
  await evaluate(owner, 'window.neoChatView.summaryText.value="Expanded summary. ".repeat(100);window.neoChatView.summaryText.dispatchEvent(new Event("input"))');
  await until(() => evaluate(owner, `window.neoChatView.budgetView.report?.proposed?.parts.summary > ${oldPreviewTokens}`), 'edited summary estimate');
  assert.equal(await evaluate(owner, 'window.neoChatView.current().summary'), null);
  await evaluate(owner, 'window.neoChatView.summaryText.value="Mystery confirmed; seaside is a proposal.";window.neoChatView.summaryText.dispatchEvent(new Event("input"))');
  await until(() => evaluate(owner, 'window.neoChatView.current().preview.text === "Mystery confirmed; seaside is a proposal."'), 'preview saved');
  await until(() => evaluate(owner, '!!window.neoChatView.budgetView.report?.proposed'), 'edited comparison ready');
  await evaluate(owner, 'window.neoChatView.preview.scrollIntoView({block:"nearest"})');
  owner.showInactive(); await pause(150); fs.writeFileSync(path.join(scratch, 'budget-preview.png'), (await owner.webContents.capturePage()).toPNG()); owner.hide();
  await evaluate(owner, 'window.neoChatView.apply.click()');
  await until(() => evaluate(owner, '!!window.neoChatView.current().summary'), 'apply summary');
  assert.deepEqual(chatData().conversations[0].messages, original);
  // Export uses full originals even while a summary is active, and sends no
  // provider request. Preserve an existing Note in a folder at the same time.
  await evaluate(owner, 'book.workspaceTree.notes.push({id:"folder-existing",type:"folder",title:"Existing notes",children:[{id:"doc-existing",type:"document",title:"Keep me",text:"Original note"}]});scheduleMetaSave()');
  const requestsBeforeExport = requests.length;
  await evaluate(owner, 'window.neoChatView.exportButton.click()');
  await until(() => evaluate(owner, 'window.neoChatView.status.textContent.startsWith("Saved to Notes as")'), 'export in workspace');
  const bookMeta = () => JSON.parse(fs.readFileSync(path.join(libraryDir, 'book-one', 'book.json'), 'utf8'));
  const firstExport = bookMeta().workspaceTree.notes.find(item => item.type === 'document');
  assert.equal(firstExport.title, chatData().conversations[0].title);
  for (const message of original) assert.ok(firstExport.text.includes(message.content));
  assert.equal(bookMeta().workspaceTree.notes[0].children[0].text, 'Original note');
  assert.equal(requests.length, requestsBeforeExport);
  assert.deepEqual(chatData().conversations[0].messages, original);
  assert.equal(await evaluate(owner, 'currentTab'), 'ai-assistance');
  await send(owner, 'Continue with the approved choices'); await until(() => ready(owner), 'reply after summary');
  assert.ok(requests.at(-1).body.messages[1].content.includes('Mystery confirmed'));
  assert.equal(requests.at(-1).body.messages.length, 7);
  await evaluate(owner, 'window.neoChatView.restore.click()');
  await until(() => evaluate(owner, '!window.neoChatView.current().summary && !window.neoChatView.requestBusy'), 'restore');
  console.log('PASS: chat discovery, model selection, streaming, persistence, editable compaction, originals and restored history');
  slow = true; await send(owner, 'Slow request');
  await until(() => evaluate(owner, 'window.neoChatView.current().messages.at(-1).content.includes("seaside")'), 'partial text');
  assert.equal(await evaluate(owner, 'window.neoChatView.exportButton.disabled'), true);
  await evaluate(owner, 'window.neoChatView.stopButton.click()');
  await until(() => ready(owner), 'stopped'); assert.equal(chatData().conversations[0].messages.at(-1).status, 'stopped');
  slow = false; bad = true; await send(owner, 'Rejected request'); await until(() => ready(owner), 'failed request');
  assert.match(chatData().conversations[0].messages.at(-1).error, /HTTP 401/);
  assert.ok(!JSON.stringify(chatData()).includes('private server error')); bad = false;
  // Context selection never contacts the provider until Send. Disabled sources
  // are absent from the inventory text and every request rereads live eligibility.
  await evaluate(owner, `book.workspaceTree.characters.push({id:'folder-cast',type:'folder',title:'Cast',children:[{id:'doc-elara',type:'document',title:'Elara',text:'Elara source-only character facts'}]},
    {id:'folder-private',type:'folder',title:'Private research',aiContext:false,children:[{id:'doc-secret',type:'document',title:'Excluded secret',text:'Never send this secret'}]});
    book.workspaceTree.locations.push({id:'doc-place',type:'document',title:'Apartment',html:'<p>Apartment source-only facts</p><p>Second paragraph<br>Next line &lt;script&gt;literal&lt;/script&gt;</p><script>Hidden executable text</script>'});
    book.workspaceTree.darlings.push({id:'doc-cut',type:'document',title:'Cut scene',text:'Never send this darling'});renderNav();scheduleMetaSave()`);
  const beforePicker = requests.length;
  await evaluate(owner, 'window.neoChatView.contextPicker.open()');
  assert.equal(requests.length, beforePicker);
  assert.equal(await evaluate(owner, 'window.neoChatView.contextPicker.dialog.open'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.contextPicker.list.querySelector(`[data-context-id="doc-secret"]`).disabled'), true);
  const inventory = await evaluate(owner, 'window.neoChatView.contextPicker.rows');
  assert.equal(inventory.find(row => row.id === 'doc-secret').text, '');
  assert.equal(inventory.some(row => row.id === 'doc-cut'), false);
  assert.equal(inventory.find(row => row.id === 'doc-place').text, 'Apartment source-only facts\nSecond paragraph\nNext line <script>literal</script>');
  for (const id of ['doc-elara', 'doc-place']) await evaluate(owner, `window.neoChatView.contextPicker.list.querySelector('[data-context-id="${id}"]').click()`);
  assert.equal(await evaluate(owner, 'window.neoChatView.contextPicker.count.textContent.startsWith("2 documents")'), true);
  assert.equal(await evaluate(owner, 'window.neoChatView.contextPicker.text.querySelector("script") === null'), true);
  await evaluate(owner, 'window.neoChatView.contextPicker.text.querySelector("details").open=true');
  owner.showInactive(); await pause(150); fs.writeFileSync(path.join(scratch, 'context.png'), (await owner.webContents.capturePage()).toPNG()); owner.hide();
  await until(() => evaluate(owner, '!window.neoChatView.contextPicker.loading'), 'context refresh completes before apply');
  await evaluate(owner, 'window.neoChatView.contextPicker.save()');
  assert.deepEqual(chatData().conversations[0].contextIds, ['doc-elara', 'doc-place']);
  await until(() => evaluate(owner, 'window.neoChatView.budgetView.report?.current.sources.length === 2'), 'live document budget');
  assert.ok(await evaluate(owner, 'window.neoChatView.budgetView.report.current.parts.documents > 0'));
  await send(owner, 'Use my selected references'); await until(() => ready(owner), 'context reply');
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Elara source-only character facts'));
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Apartment source-only facts'));
  assert.ok(!JSON.stringify(requests).includes('Never send this') && !JSON.stringify(requests).includes('Private manuscript fixture'));
  assert.ok(!JSON.stringify(chatData()).includes('source-only'));
  // Manuscript extraction reads the live DOM and omits ghost outline text.
  await evaluate(owner, `document.querySelector('.chapter-body').innerHTML += '<p>Live manuscript-only source prose</p><p class="ghost">Never send a ghost outline</p>'`);
  await evaluate(owner, 'window.neoChatView.contextPicker.open()');
  await evaluate(owner, 'window.neoChatView.contextPicker.list.querySelector(`[data-context-id="ch-one"]`).click();window.neoChatView.contextPicker.save()');
  await send(owner, 'Use the selected scene'); await until(() => ready(owner), 'live manuscript reply');
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Live manuscript-only source prose'));
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Private manuscript fixture'));
  assert.ok(!JSON.stringify(requests.at(-1).body).includes('Never send a ghost'));
  await evaluate(owner, 'window.neoChatView.contextPicker.open()');
  await evaluate(owner, 'window.neoChatView.contextPicker.list.querySelector(`[data-context-id="ch-one"]`).click();window.neoChatView.contextPicker.save()');
  await evaluate(owner, 'openWorkspaceNode("characters","doc-elara");document.querySelector(".tree-document-text").textContent="Latest unsaved character source-only facts";document.querySelector(".tree-document-text").dispatchEvent(new Event("input"));switchTab("ai-assistance")');
  await send(owner, 'Use the latest character'); await until(() => ready(owner), 'live source reply');
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Latest unsaved character source-only facts'));
  assert.ok(!JSON.stringify(requests.at(-1).body).includes('Live manuscript-only source prose'));
  await evaluate(owner, 'book.workspaceTree.characters.find(node=>node.id==="folder-cast").aiContext=false');
  await send(owner, 'Respect the changed folder exclusion'); await until(() => ready(owner), 'excluded source reply');
  assert.ok(!JSON.stringify(requests.at(-1).body).includes('character source-only facts'));
  assert.equal(chatData().conversations[0].messages.at(-2).contextOmitted, 1);
  await evaluate(owner, 'WorkspaceTree.transfer(book.workspaceTree,"characters","darlings","doc-elara",null,null);scheduleMetaSave()');
  await send(owner, 'Respect the move to Darlings'); await until(() => ready(owner), 'Darlings source reply');
  assert.ok(!JSON.stringify(requests.at(-1).body).includes('character source-only facts'));
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Apartment source-only facts'));
  console.log('PASS: context picker, exact plain-text preview, no provider traffic before send, chosen sources, live edits, folder exclusions, Darlings moves and source text kept out of saved chat');
  await evaluate(owner, 'window.neoChatView.connection.value="responses";window.neoChatView.connection.dispatchEvent(new Event("change"))');
  await until(() => evaluate(owner, 'window.neoChatView.current().profileId === "responses" && !window.neoChatView.requestBusy'), 'Responses config');
  await send(owner, 'Test Responses'); await until(() => ready(owner), 'Responses reply'); assert.equal(requests.at(-1).body.store, false);
  assert.ok(JSON.stringify(requests.at(-1).body.input).includes('Apartment source-only facts'));
  await evaluate(owner, 'window.neoChatView.draft.value="A saved unfinished question";window.neoChatView.draft.dispatchEvent(new Event("input"));window.neoChatView.detachButton.click()');
  await until(() => paneWindow(), 'detach'); let pane = paneWindow(); pane.webContents.setBackgroundThrottling(false);
  await until(() => evaluate(pane, '!!view.current()'), 'pane ready');
  await evaluate(pane, 'view.draft.value="A saved unfinished question";view.draft.dispatchEvent(new Event("input"))');
  await openChatNode(secondId);
  await until(() => evaluate(pane, `view.current()?.id === ${JSON.stringify(secondId)}`), 'sidebar switches detached chat');
  assert.equal(await evaluate(pane, 'view.current().messages.length'), 0);
  await openChatNode(firstId);
  await until(() => evaluate(pane, `view.current()?.id === ${JSON.stringify(firstId)}`), 'sidebar restores detached chat');
  await until(() => evaluate(pane, 'view.assistant.value === "characters"'), 'restored assistant type rendered');
  assert.equal(await evaluate(pane, 'view.assistant.value'), 'characters');
  assert.equal(await evaluate(pane, 'view.assistant.selectedOptions[0].textContent'), 'Characters');
  assert.equal(await evaluate(pane, 'view.model.hidden'), false);
  assert.equal(await evaluate(pane, 'view.model.value'), 'fixture-model');
  await evaluate(pane, 'view.connection.value="local";view.connection.dispatchEvent(new Event("change"))');
  await until(() => evaluate(pane, 'view.current().profileId === "local" && !view.requestBusy'), 'saved model list in fresh pane');
  assert.deepEqual(await evaluate(pane, 'Array.from(view.model.options).slice(1, -1).map(o=>o.value)'), ['fixture-model', 'other-model']);
  await evaluate(pane, 'view.connection.value="responses";view.connection.dispatchEvent(new Event("change"))');
  await until(() => evaluate(pane, 'view.current().profileId === "responses" && !view.requestBusy'), 'restore Responses profile');
  assert.equal(await evaluate(pane, 'view.draft.value'), 'A saved unfinished question');
  assert.equal(await evaluate(pane, 'view.draft.value'), 'A saved unfinished question');
  assert.equal(await evaluate(owner, 'window.neoChatView.draft.disabled'), true);
  await keyboardSend(pane, 'Question from a separate monitor'); await until(() => ready(pane), 'pane reply');
  // Keep editing Notes in the owner while exporting from detached chat.
  await evaluate(owner, 'openWorkspaceNode("notes","doc-existing");document.querySelector(".tree-document-text").textContent="Latest unsaved note";document.querySelector(".tree-document-text").dispatchEvent(new Event("input"))');
  await evaluate(pane, 'view.contextPicker.open()');
  await evaluate(pane, 'view.contextPicker.clear.click();view.contextPicker.list.querySelector(`[data-context-id="doc-existing"]`).click()');
  assert.equal(await evaluate(pane, 'view.contextPicker.text.textContent.includes("Latest unsaved note")'), true);
  await until(() => evaluate(pane, '!!view.budgetView.report'), 'detached budget');
  assert.equal(await evaluate(pane, 'view.budgetView.report.capacity.limit'), await evaluate(owner, 'window.neoChatView.budgetView.report.capacity.limit'));
  await evaluate(pane, 'view.budgetView.detailsButton.click()');
  await until(() => evaluate(pane, '!!view.budgetView.report'), 'budget details');
  pane.setSize(900, 960); await pause(150);
  fs.writeFileSync(path.join(scratch, 'budget-details.png'), (await pane.webContents.capturePage()).toPNG());
  await evaluate(pane, 'view.budgetView.details.close();view.options.scrollTop=0');
  pane.setSize(560, 820); await pause(100);
  assert.equal(await evaluate(pane, 'view.contextPicker.dialog.scrollWidth <= view.contextPicker.dialog.clientWidth'), true);
  assert.equal(await evaluate(pane, 'view.contextPicker.apply.getBoundingClientRect().bottom <= innerHeight'), true);
  fs.writeFileSync(path.join(scratch, 'context-pane.png'), (await pane.webContents.capturePage()).toPNG());
  await evaluate(pane, 'view.contextPicker.save()');
  await send(pane, 'Use the note from my workspace'); await until(() => ready(pane), 'pane context reply');
  assert.ok(JSON.stringify(requests.at(-1).body.input).includes('Latest unsaved note'));
  assert.ok(!JSON.stringify(requests.at(-1).body.input).includes('Apartment source-only facts'));
  await evaluate(pane, 'view.exportButton.click()');
  await until(() => evaluate(pane, 'view.status.textContent.startsWith("Saved to Notes as")'), 'export from detached chat');
  let exportedNotes = bookMeta().workspaceTree.notes.filter(item => item.type === 'document');
  assert.equal(exportedNotes.length, 2); assert.equal(exportedNotes[1].title, firstExport.title + ' (2)');
  assert.ok(exportedNotes[1].text.includes('Question from a separate monitor'));
  assert.ok(exportedNotes[1].text.includes('[Reply stopped]') && exportedNotes[1].text.includes('[Reply failed]'));
  assert.deepEqual(exportedNotes[0], firstExport);
  assert.equal(bookMeta().workspaceTree.notes[0].children[0].text, 'Latest unsaved note');
  assert.equal(await evaluate(owner, 'currentTab'), 'notes');
  assert.equal(await evaluate(owner, 'workspaceSelection.id'), 'doc-existing');
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text").textContent'), 'Latest unsaved note');
  assert.equal(await evaluate(owner, 'document.querySelector(`.workspace-tree[data-section="notes"] .workspace-node[data-id="' + exportedNotes[1].id + '"]`) !== null'), true);
  // A failed book metadata write must not leave a phantom export in memory.
  await evaluate(owner, 'flushAllSaves()');
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === path.join(libraryDir, 'book-one', 'book.json')) { const failure = new Error('Fixture disk failure'); failure.code = 'EACCES'; throw failure; }
    return rename(source, destination);
  };
  try {
    await evaluate(pane, 'view.exportButton.click()');
    await until(() => evaluate(pane, 'view.status.textContent.includes("Could not save the chat to Notes") && !view.requestBusy'), 'failed export preserved');
  } finally { fs.renameSync = rename; }
  assert.equal(bookMeta().workspaceTree.notes.filter(item => item.type === 'document').length, 2);
  assert.equal(await evaluate(owner, 'book.workspaceTree.notes.filter(item=>item.type==="document").length'), 2);
  console.log('PASS: full chat export to Notes in both windows, compaction originals, repeated snapshots, existing edits and rollback after save failure');
  console.log('PASS: Enter sends in both windows; Shift+Enter adds a line; Ctrl/Cmd+Enter sends without toggling fullscreen; IME and repeat guards work');
  await evaluate(pane, 'void closeChat(true)'); await until(() => !paneWindow(), 'dock');
  assert.equal(await evaluate(owner, 'currentTab'), 'ai-assistance');
  assert.equal(await evaluate(owner, 'window.neoChatView.draft.disabled'), false);
  // AI Assistance folders and documents continue using the existing tree editor.
  await evaluate(owner, 'book.workspaceTree["ai-assistance"].push({id:"doc-fixture",type:"document",title:"AI notebook",text:"Reference note"});renderNav();openWorkspaceNode("ai-assistance","doc-fixture")');
  assert.equal(await evaluate(owner, 'window.neoChatView.root.hidden'), true);
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text").textContent'), 'Reference note');
  // AI Assistance's New document menu creates a named conversation in its
  // chosen folder. It can move anywhere without becoming manuscript prose.
  await evaluate(owner, `book.workspaceTree['ai-assistance'].push({id:'folder-chats',type:'folder',title:'Character brainstorming',children:[]});renderWorkspaceTrees();document.querySelector('.workspace-node[data-id="folder-chats"] > .tree-row .tree-menu').click();document.querySelectorAll('.workspace-add-menu button')[1].click()`);
  await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'chat name dialog');
  await evaluate(owner, 'document.querySelector(".modal-backdrop:not([hidden]) input").value="Sarah conversation";document.querySelector(".modal-backdrop:not([hidden]) .m-ok").click()');
  await until(() => evaluate(owner, 'workspaceSelection && window.neoChatView.current()?.title === "Sarah conversation" && !window.neoChatView.requestBusy'), 'chat created in folder');
  const nestedChat = await evaluate(owner, 'workspaceChatNodes().find(item=>item.node.title === "Sarah conversation").node');
  assert.equal(await evaluate(owner, `WorkspaceTree.find(book.workspaceTree['ai-assistance'], ${JSON.stringify(nestedChat.id)}).parentId`), 'folder-chats');
  assert.equal(await evaluate(owner, 'treeEditor.hidden && !window.neoChatView.root.hidden'), true);
  await send(owner, 'Sarah brainstorming'); await until(() => ready(owner), 'nested chat reply');
  await evaluate(owner, `void renameWorkspaceItem('ai-assistance',${JSON.stringify(nestedChat.id)})`);
  await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) input")'), 'rename chat dialog');
  await evaluate(owner, 'document.querySelector(".modal-backdrop:not([hidden]) input").value="Sarah Vance";document.querySelector(".modal-backdrop:not([hidden]) .m-ok").click()');
  await until(() => evaluate(owner, 'window.neoChatView.current().title === "Sarah Vance" && workspaceChatNodes().some(item=>item.node.title==="Sarah Vance")'), 'chat renamed');
  const orderBeforeChatMove = await evaluate(owner, 'book.chapterOrder');
  await evaluate(owner, `moveWorkspaceItem('ai-assistance',${JSON.stringify(nestedChat.id)},null,null,'manuscript')`);
  assert.deepEqual(await evaluate(owner, 'book.chapterOrder'), orderBeforeChatMove);
  assert.equal(fs.existsSync(path.join(libraryDir, 'book-one', 'chapters', nestedChat.id + '.html')), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.root.hidden'), false);
  assert.equal(await evaluate(owner, 'window.neoChatView.current().messages[0].content'), 'Sarah brainstorming');
  await evaluate(owner, `moveWorkspaceItem('manuscript',${JSON.stringify(nestedChat.id)},'folder-chats',null,'ai-assistance')`);
  await evaluate(owner, `void deleteWorkspaceItem('ai-assistance',${JSON.stringify(nestedChat.id)})`);
  await until(() => evaluate(owner, '!!document.querySelector(".modal-backdrop:not([hidden]) .fr-choice")'), 'delete chat dialog');
  await evaluate(owner, 'document.querySelector(".modal-backdrop:not([hidden]) .fr-choice").click()');
  await until(() => evaluate(owner, `!workspaceChatNodes().some(item=>item.node.id===${JSON.stringify(nestedChat.id)})`), 'chat removed');
  await evaluate(owner, 'window.neoChatView.showBook(book.id,book.title)');
  assert.equal(await evaluate(owner, `window.neoChatView.chatConversations().some(c=>c.id===${JSON.stringify(nestedChat.conversationId)})`), false);
  await evaluate(owner, 'structuralUndo()');
  await until(() => evaluate(owner, `workspaceChatNodes().some(item=>item.node.id===${JSON.stringify(nestedChat.id)}) && window.neoChatView.chatConversations().some(c=>c.id===${JSON.stringify(nestedChat.conversationId)})`), 'chat restored by undo');
  await openChatNode(firstId);
  console.log('PASS: saved chats have sidebar entries; clicking restores history/drafts; menu creates chats in folders; rename, cross-section moves, manuscript exclusion, delete and undo preserve chat data');
  await evaluate(owner, 'switchTab("ai-assistance")');
  formattedReply = true;
  await send(owner, '**Keep my prompt literal**'); await until(() => ready(owner), 'formatted reply');
  await until(() => evaluate(owner, '!!window.neoChatView.transcript.querySelector(".ai-markdown ol ul li")'), 'completed Markdown rendered');
  assert.equal(chatData().conversations[0].messages.at(-1).content, markdownReply);
  assert.equal(await evaluate(owner, 'window.neoChatView.transcript.querySelector(".ai-markdown ol ul li").textContent'), 'A nested detail');
  assert.equal(await evaluate(owner, 'window.neoChatView.transcript.querySelector(".ai-markdown strong").textContent'), 'Sarah');
  assert.equal(await evaluate(owner, '!!window.markdownExecuted || !!window.neoChatView.transcript.querySelector("script,img,iframe")'), false);
  assert.equal(await evaluate(owner, 'Array.from(window.neoChatView.transcript.querySelectorAll(".ai-user .ai-message-content")).at(-1).textContent'), '**Keep my prompt literal**');
  await evaluate(owner, 'navigator.clipboard.write = async items => {window.copiedRich = Object.fromEntries(await Promise.all(items[0].types.map(async type => [type, await (await items[0].getType(type)).text()])))}; window.neoChatView.transcript.querySelector(".ai-message:last-child button").click();');
  await until(() => evaluate(owner, '!!window.copiedRich'), 'formatted clipboard');
  assert.match(await evaluate(owner, 'window.copiedRich["text/html"]'), /<h3>Established Facts<\/h3>/);
  assert.match(await evaluate(owner, 'window.copiedRich["text/html"]'), /<strong>Sarah<\/strong>/);
  assert.match(await evaluate(owner, 'window.copiedRich["text/plain"]'), /1\. Motivation/);
  assert.doesNotMatch(await evaluate(owner, 'window.copiedRich["text/plain"]'), /\*\*Sarah\*\*|### Established/);
  await evaluate(owner, 'window.neoChatView.transcript.lastElementChild.scrollIntoView({block:"start"})');
  owner.showInactive(); await pause(150); fs.writeFileSync(path.join(scratch, 'chat-markdown.png'), (await owner.webContents.capturePage()).toPNG()); owner.hide();
  // Paste into an existing plain character card, then navigate away and reload.
  await evaluate(owner, `WorkspaceTree.transfer(book.workspaceTree,'darlings','characters','doc-elara','folder-cast',null);
    delete WorkspaceTree.find(book.workspaceTree.characters,'doc-elara').node.html;
    openWorkspaceNode('characters','doc-elara'); (() => {
    const editor = document.querySelector('.tree-document-text'); editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const data = new DataTransfer(); for (const [type, value] of Object.entries(window.copiedRich)) data.setData(type, value);
    editor.dispatchEvent(new ClipboardEvent('paste', {clipboardData:data,bubbles:true,cancelable:true}));
  })(); flushAllSaves()`);
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text h3").textContent'), 'Established Facts');
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text ol ul li").textContent'), 'A nested detail');
  assert.match(await evaluate(owner, 'document.querySelector(".tree-document-text").textContent'), /Latest unsaved character source-only facts/);
  assert.match(bookMeta().workspaceTree.characters.find(n=>n.id==='folder-cast').children[0].html, /<h3>/);
  await evaluate(owner, 'switchTab("locations");openWorkspaceNode("characters","doc-elara")');
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text strong").textContent'), 'Sarah');
  owner.showInactive(); await pause(150); fs.writeFileSync(path.join(scratch, 'pasted-chat.png'), (await owner.webContents.capturePage()).toPNG()); owner.hide();
  // Clean arbitrary clipboard HTML and keep every heading/list word in exports.
  assert.equal(await evaluate(owner, `(() => {const h=document.createElement('div');h.innerHTML=DocumentRichText.clean('<h3 onclick="evil()">Heading</h3><img src="https://example.com/a"><script>evil()</script><ol start="3"><li><b>Item</b></li></ol>');return !!h.querySelector('script,img,[onclick]')})()`), false);
  assert.match(await evaluate(owner, 'parasFromHtml(window.copiedRich["text/html"]).map(p=>p.text).join(" ")'), /Established Facts.*Sarah.*Motivation.*A nested detail/s);
  // The manuscript paste path must also retain structure and persist it.
  await evaluate(owner, `switchTab('manuscript'); (() => {
    const body=document.querySelector('.chapter-body'); window.originalChapterForPaste=body.innerHTML; body.focus();
    const range=document.createRange();range.selectNodeContents(body);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    const data=new DataTransfer();for(const [type,value] of Object.entries(window.copiedRich))data.setData(type,value);
    body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  })();flushAllSaves()`);
  assert.equal(await evaluate(owner, 'document.querySelector(".chapter-body h3").textContent'), 'Established Facts');
  assert.match(fs.readFileSync(path.join(libraryDir,'book-one','chapters','ch-one.html'),'utf8'), /<h3>/);
  await evaluate(owner, `(() => {const body=document.querySelector('.chapter-body');body.innerHTML=window.originalChapterForPaste;body.dispatchEvent(new Event('input',{bubbles:true}));})();flushAllSaves()`);
  await openChatNode(firstId);
  formattedReply = false;
  await evaluate(owner, 'window.neoChatView.draft.value="Survive reload";window.neoChatView.draft.dispatchEvent(new Event("input"));window.neoChatView.flushEdits()');
  owner.reload(); await until(() => !owner.webContents.isLoadingMainFrame() && evaluate(owner, '!!window.neoChatView && typeof library !== "undefined" && !!library'), 'reload');
  await evaluate(owner, 'openBook("book-one");'); await evaluate(owner, 'switchTab("ai-assistance")');
  await until(() => evaluate(owner, 'window.neoChatView.draft.value === "Survive reload"'), 'draft restored');
  await evaluate(owner, 'openWorkspaceNode("characters","doc-elara")');
  assert.equal(await evaluate(owner, 'document.querySelector(".tree-document-text h3").textContent'), 'Established Facts');
  await openChatNode(firstId);
  assert.equal(await evaluate(owner, 'window.neoChatView.transcript.querySelector(".ai-markdown h3").textContent'), 'Established Facts');
  assert.equal(await evaluate(owner, 'workspaceChatNodes().length === window.neoChatView.chatConversations().length'), true);
  assert.deepEqual(await evaluate(owner, 'window.neoChatView.current().contextIds'), ['doc-existing']);
  assert.deepEqual(bookMeta().workspaceTree.notes.filter(item => item.type === 'document'), exportedNotes);
  slow = true; await send(owner, 'Cancel on book change');
  await until(() => evaluate(owner, '!!window.neoChatView.state.job'), 'active before book change');
  await evaluate(owner, 'openBook("book-two")'); await evaluate(owner, 'switchTab("ai-assistance")');
  await until(() => evaluate(owner, 'window.neoChatView.bookId === "book-two" && !!window.neoChatView.current()'), 'second book');
  assert.equal(await evaluate(owner, 'window.neoChatView.current().messages.length'), 0);
  assert.equal(await evaluate(owner, 'workspaceChatNodes().some(item=>item.node.conversationId==="legacy-chat" && item.node.title==="Previously saved chat")'), true);
  assert.deepEqual(await evaluate(owner, 'window.neoChatView.current().contextIds'), []);
  assert.equal(chatData().conversations[0].messages.at(-1).status, 'stopped'); slow = false;
  await evaluate(owner, 'openBook("book-one")'); await evaluate(owner, 'switchTab("ai-assistance")');
  await until(() => evaluate(owner, 'window.neoChatView.bookId === "book-one" && !!window.neoChatView.current()'), 'first book restored');
  assert.equal(await evaluate(owner, 'document.querySelector("#editor-view").hidden'), false);
  owner.showInactive(); await pause(350); fs.writeFileSync(path.join(scratch, 'chat.png'), (await owner.webContents.capturePage()).toPNG()); owner.hide();
  await evaluate(owner, 'window.neoChatView.detachButton.click()'); await until(() => paneWindow(), 'detach again'); pane = paneWindow();
  await until(() => evaluate(pane, '!!view.current()'), 'detached again');
  assert.equal(await evaluate(pane, 'view.transcript.querySelector(".ai-markdown h3").textContent'), 'Established Facts');
  assert.equal(await evaluate(pane, '!!window.markdownExecuted || !!view.transcript.querySelector("script,img,iframe")'), false);
  await evaluate(pane, `navigator.clipboard.write=async items=>{window.detachedCopy=await(await items[0].getType('text/html')).text()};view.copyMessage(view.current().messages.find(m=>m.content.startsWith('### Established Facts')))`);
  assert.match(await evaluate(pane, 'window.detachedCopy'), /<strong>Sarah<\/strong>/);
  await until(() => evaluate(pane, '!!view.budgetView.report'), 'detached budget');
  assert.equal(await evaluate(pane, 'view.budgetView.report.capacity.limit'), await evaluate(owner, 'window.neoChatView.budgetView.report.capacity.limit'));
  await evaluate(pane, 'view.budgetView.detailsButton.click()');
  await until(() => evaluate(pane, '!!view.budgetView.report'), 'budget details');
  pane.setSize(900, 960); await pause(150);
  fs.writeFileSync(path.join(scratch, 'budget-details.png'), (await pane.webContents.capturePage()).toPNG());
  await evaluate(pane, 'view.budgetView.details.close();view.options.scrollTop=0');
  pane.setSize(560, 820); await pause(150); assert.equal(await evaluate(pane, 'document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate(pane, 'view.sendButton.getBoundingClientRect().bottom <= innerHeight'), true);
  fs.writeFileSync(path.join(scratch, 'chat-pane.png'), (await pane.webContents.capturePage()).toPNG());
  const branchSourceId = await evaluate(pane, 'view.current().id');
  const originalMessages = await evaluate(pane, 'view.current().messages');
  const originalCount = await evaluate(pane, 'view.state.conversations.length');
  await evaluate(pane, 'view.transcript.querySelector(".ai-assistant .ai-revise").click()');
  await until(() => evaluate(pane, `view.current()?.id !== ${JSON.stringify(branchSourceId)} && !view.state.job && !view.requestBusy`), 'retried response');
  assert.equal(await evaluate(pane, 'view.state.conversations.length'), originalCount + 1);
  assert.equal(await evaluate(pane, 'view.current().messages.length'), 2);
  assert.equal(await evaluate(pane, 'view.current().messages[0].content'), originalMessages[0].content);
  assert.deepEqual(await evaluate(pane, `view.state.conversations.find(c=>c.id===${JSON.stringify(branchSourceId)}).messages`), originalMessages);
  assert.equal(await evaluate(owner, 'workspaceChatNodes().some(item=>item.node.title.includes("Retry"))'), true);
  const retryId = await evaluate(pane, 'view.current().id');
  await evaluate(pane, 'view.transcript.querySelector(".ai-user .ai-revise").click()');
  assert.equal(await evaluate(pane, 'view.editDialog.open'), true);
  await evaluate(pane, 'view.editPrompt.value="Discard this revision";view.editDialog.querySelector("button").click()');
  assert.equal(await evaluate(pane, 'view.state.conversations.length'), originalCount + 1);
  await evaluate(pane, 'view.transcript.querySelector(".ai-user .ai-revise").click();view.editPrompt.value="Explore a different opening"');
  pane.setSize(900,960); await pause(100);
  fs.writeFileSync(path.join(scratch,'edit-resend.png'), (await pane.webContents.capturePage()).toPNG());
  await evaluate(pane, 'view.editDialog.querySelector("form").requestSubmit()');
  await until(() => evaluate(pane, `view.current()?.id !== ${JSON.stringify(retryId)} && !view.state.job && !view.requestBusy`), 'revised prompt reply');
  assert.equal(await evaluate(pane, 'view.current().messages[0].content'), 'Explore a different opening');
  assert.equal(requests.at(-1).body.input.at(-1).content.includes('Explore a different opening'), true);
  assert.deepEqual(await evaluate(pane, `view.state.conversations.find(c=>c.id===${JSON.stringify(branchSourceId)}).messages`), originalMessages);
  await openChatNode(branchSourceId);
  await until(() => evaluate(pane, `view.current()?.id === ${JSON.stringify(branchSourceId)}`), 'return to original chat');
  console.log('PASS: saved reply settings reach context and provider; retry and edited prompts create selectable chats, preserve originals, and cancel without changes');
  // An unrelated renderer with the bridge cannot access chats.
  const intruder = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../ai-preload.js'), contextIsolation: true, sandbox: true } });
  await intruder.loadFile(path.join(__dirname, '../ai-pane.html'));
  const denied = await evaluate(intruder, 'window.neoChat.read("book-one")'); assert.match(denied.error, /denied/);
  const exportDenied = await evaluate(intruder, 'window.neoChat.exportConversation("book-one", "any-chat")'); assert.match(exportDenied.error, /denied/);
  const budgetDenied = await evaluate(intruder, 'window.neoChat.budget("book-one","any-chat","")'); assert.match(budgetDenied.error, /denied/);
  const limitDenied = await evaluate(intruder, 'window.neoChat.setContextLimit("book-one","local","fixture-model",8192)'); assert.match(limitDenied.error, /denied/);
  const contextDenied = await evaluate(intruder, 'window.neoChat.context("book-one")'); assert.match(contextDenied.error, /denied/);
  slow = true; await send(pane, 'Close while writing'); await until(() => evaluate(pane, '!!view.state.job'), 'reply before close');
  owner.close(); await until(() => owner.isDestroyed() && pane.isDestroyed(), 'safe close');
  assert.equal(chatData().conversations[0].messages.at(-1).status, 'stopped');
  assert.match(fs.readFileSync(path.join(libraryDir, 'book-one', 'chapters/ch-one.html'), 'utf8'), /Private manuscript fixture/);
  // Intruder's intentionally rejected pane-state request is the only expected error.
  assert.ok(errors.every(error => error.includes('Unknown window')), errors.join('\n'));
  console.log('PASS: Stop, safe provider failures, Responses, detach/dock, folders, reload, book isolation, IPC authorization and close while streaming');
  console.log('Screenshots: ' + scratch);
  intruder.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); console.error(errors); server.close(); app.exit(1); });
setTimeout(() => { console.error('Chat integration test exceeded 90 seconds.'); app.exit(1); }, 90000).unref();
