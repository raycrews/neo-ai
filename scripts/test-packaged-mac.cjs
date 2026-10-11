// Run the app copied from the actual DMG with an isolated device profile/library.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const asar = require('@electron/asar');
const version = require('../package.json').version;
assert.equal(process.platform, 'darwin', 'Run on a Mac');
assert.equal(process.arch, 'arm64', 'Run natively on Apple silicon');
const dmg = path.resolve(`dist/Neo-AI-${version}-mac-arm64.dmg`);
// macOS resolves /var to /private/var when reporting Chromium's profile path.
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'neo-packaged-mac-')));
const volume = path.join(scratch, 'volume');
const installed = path.join(scratch, 'Applications', 'Neo-AI.app');
const profile = path.join(scratch, 'device');
const libraryDir = path.join(scratch, 'books');
const executable = path.join(installed, 'Contents', 'MacOS', 'Neo-AI');
for (const directory of [volume, profile, libraryDir]) fs.mkdirSync(directory, { recursive: true });
// Direct the normal first-run library initialization into an empty test folder.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ libraryDir, initializeLibrary: true }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, name, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('Timed out: ' + name);
}
async function connect(url) {
  const socket = new WebSocket(url); await once(socket, 'open');
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  return { close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}
async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
let child, page, main, mounted = false, log = '';
const watchdog = setTimeout(() => {
  console.error('Packaged Mac test exceeded three minutes. Last application output:\n' + log.slice(-12000));
  if (child && child.exitCode === null) child.kill('SIGKILL');
  if (mounted) { try { execFileSync('hdiutil', ['detach', '-force', volume], { timeout: 15000 }); } catch {} }
  process.exit(1);
}, 180000);
const provider = http.createServer(async (req, res) => {
  for await (const chunk of req) { /* Drain the test request. */ }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ data: [{ id: 'mac-fixture' }] }));
  }
  if (req.url === '/v1/chat/completions') {
    res.setHeader('Content-Type', 'text/event-stream');
    return res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Packaged Mac reply.' } }] }) + '\n\ndata: [DONE]\n\n');
  }
  res.writeHead(404); res.end();
});
async function launch() {
  console.log('Launching installed app with temporary settings.');
  log = ''; let endpoint, inspector;
  child = spawn(executable, ['--remote-debugging-port=0', '--inspect=0', '--user-data-dir=' + profile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    log += data.toString();
    endpoint = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
    inspector = log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
  });
  await until(() => {
    if (child.exitCode !== null || child.signalCode) throw new Error('Packaged Mac exited: ' + log);
    return endpoint && inspector;
  }, 'packaged startup');
  main = await connect(inspector);
  assert.equal(await evaluate(main, 'process.arch', false), 'arm64');
  assert.equal(await evaluate(main, "process.mainModule.require('electron').app.isPackaged", false), true);
  assert.equal(await evaluate(main, "process.mainModule.require('electron').app.getPath('userData')", false), profile);
  const address = endpoint.replace('ws:', 'http:').split('/devtools/')[0];
  async function target(file) {
    const item = await until(async () => (await (await fetch(address + '/json/list')).json()).find(row => row.type === 'page' && row.url.endsWith('/' + file)), file);
    return connect(item.webSocketDebuggerUrl);
  }
  page = await target('index.html');
  await until(() => evaluate(page, 'typeof library !== "undefined" && !!library'), 'library loaded');
  return target;
}
async function close() {
  console.log('Quitting installed app.');
  page?.close();
  await evaluate(main, "setTimeout(() => process.mainModule.require('electron').app.quit(), 100); undefined", false);
  main.close();
  await until(() => child.exitCode !== null || child.signalCode, 'application quit');
  assert.equal(child.exitCode, 0, 'app quits normally after saving');
}
(async () => {
  console.log('Verifying and mounting DMG.');
  execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit', timeout: 60000 });
  execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', volume, dmg], { stdio: 'inherit', timeout: 60000 });
  mounted = true;
  assert.ok(fs.existsSync(path.join(volume, 'Applications')), 'DMG Applications shortcut');
  execFileSync('ditto', [path.join(volume, 'Neo-AI.app'), installed], { timeout: 60000 });
  execFileSync('hdiutil', ['detach', volume], { stdio: 'inherit', timeout: 30000 }); mounted = false;
  assert.equal(execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim(), 'arm64');
  const archive = path.join(installed, 'Contents', 'Resources', 'app.asar');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
  assert.equal(asar.listPackage(archive).some(file => /\/(settings|library|book|ai-connections|secrets|profile-location)\.json$/.test(file)), false, 'no personal data bundled');
  console.log('PASS: DMG verifies, app installs by copying, and executable is ARM64.');
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  let target = await launch();
  console.log('Checking onboarding and Mac title-bar spacing.');
  assert.equal(await evaluate(page, 'window.neo.libraryPath()'), libraryDir);
  assert.equal(await evaluate(page, 'window.neo.appVersion()'), version);
  assert.equal(await evaluate(page, 'library.authorName'), '');
  assert.equal(await evaluate(page, 'library.shelves.flatMap(s=>s.bookIds).length'), 0);
  assert.equal(await evaluate(page, 'document.querySelector("#firstrun").hidden'), false);
  assert.equal(await evaluate(page, 'document.documentElement.classList.contains("native-titlebar")'), false);
  assert.ok(await evaluate(page, 'document.querySelector("#dragstrip").getBoundingClientRect().height > 0'), 'Mac title-bar space retained');
  await evaluate(page, `document.querySelector('#fr-name').value='Mac Test'; document.querySelector('#fr-step1 [data-style=pantser]').click(); document.querySelector('#fr-done').click(); undefined`);
  await until(() => evaluate(page, 'document.querySelector("#firstrun").hidden'), 'onboarding');
  const id = await evaluate(page, `(async () => {
    const meta = await window.neo.createBook({title:'Mac package test',author:'Mac Test'});
    meta.chapterOrder=['chapter-test']; await window.neo.writeBookMeta(meta.id,meta);
    await window.neo.writeChapter(meta.id,'chapter-test','<p>A <strong>saved</strong> Mac paragraph.</p>');
    library.shelves[0].bookIds.push(meta.id); await window.neo.writeLibrary(library);
    await openBook(meta.id); return meta.id;
  })()`);
  assert.match(await evaluate(page, 'document.querySelector(".chapter-body").innerHTML'), /<strong>saved<\/strong>/);
  console.log('Testing settings and backup.');
  await evaluate(page, 'window.neo.openSettings()'); const settings = await target('settings.html');
  assert.equal((await evaluate(settings, 'window.settingsAPI.read()')).profiles.length, 0);
  assert.deepEqual(await evaluate(settings, 'window.settingsAPI.instructionLibrary()'), []);
  await evaluate(settings, `window.settingsAPI.save({name:'Mac test provider',provider:'compatible',api:'chat',model:'mac-fixture',baseUrl:'http://127.0.0.1:${provider.address().port}/v1',makeDefault:true})`);
  await evaluate(settings, 'window.settingsAPI.saveAppearance({theme:"light",accent:"#639fe8"})');
  await evaluate(settings, 'window.settingsAPI.backupNow()');
  await evaluate(settings, 'window.close()').catch(() => {}); settings.close();
  console.log('Testing AI chat.');
  await evaluate(page, 'switchTab("ai-assistance")');
  await until(() => evaluate(page, '!!window.neoChatView.current() && !window.neoChatView.requestBusy'), 'chat ready');
  await evaluate(page, `(() => { const v=window.neoChatView; v.draft.value='Reply to this Mac test'; v.draft.dispatchEvent(new Event('input')); return v.send(); })()`);
  await until(() => evaluate(page, 'window.neoChatView.current().messages.some(m=>m.role==="assistant" && m.content==="Packaged Mac reply.") && !window.neoChatView.state.job'), 'AI reply');
  fs.mkdirSync('dist/test-results', { recursive: true });
  fs.writeFileSync('dist/test-results/mac-arm64.png', Buffer.from((await page.send('Page.captureScreenshot')).data, 'base64'));
  await close();
  target = await launch();
  console.log('Checking saved writing and settings after reopening.');
  assert.equal(await evaluate(page, 'document.querySelector("#firstrun").hidden'), true);
  await evaluate(page, `openBook(${JSON.stringify(id)})`);
  assert.match(await evaluate(page, 'document.querySelector(".chapter-body").textContent'), /saved.*Mac/);
  assert.equal(await evaluate(page, 'window.neoAppearance.read().then(v=>v.theme)'), 'light');
  assert.ok(fs.readdirSync(path.join(libraryDir, 'Backups')).some(file => file.endsWith('.zip')));
  await evaluate(page, 'switchTab("ai-assistance")');
  await until(() => evaluate(page, 'window.neoChatView.current()?.messages.some(m=>m.content==="Packaged Mac reply.")'), 'saved chat after reopening');
  console.log('Checking normal window close and Dock reactivation.');
  await evaluate(main, "process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).close(); undefined", false);
  await until(() => evaluate(main, "process.mainModule.require('electron').BrowserWindow.getAllWindows().length === 0", false), 'workspace window close');
  assert.equal(child.exitCode, null, 'Mac keeps running after a normal window close');
  page.close();
  await evaluate(main, "process.mainModule.require('electron').app.emit('activate'); undefined", false);
  page = await target('index.html');
  await until(() => evaluate(page, 'typeof library !== "undefined" && !!library'), 'reactivated workspace');
  await close();
  console.log('PASS: installed ARM64 app onboarding, Mac title-bar space, formatted writing, AI reply, settings, backup, and persistence.');
})().catch(error => { console.error(error); console.error(log.slice(-12000)); process.exitCode = 1; })
  .finally(() => {
    clearTimeout(watchdog);
    provider.close(); page?.close(); main?.close();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child?.stdout.destroy(); child?.stderr.destroy(); child?.unref();
    if (mounted) execFileSync('hdiutil', ['detach', '-force', volume], { timeout: 15000 });
  });
