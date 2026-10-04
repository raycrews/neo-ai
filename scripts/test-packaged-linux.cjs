// Exercise the actual packaged executable with an isolated home, not Electron's
// development harness. No personal library, network AI, or email is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const asar = require('@electron/asar');
const http = require('node:http');
const version = require('../package.json').version;
const flatpak = process.argv[2] === '--flatpak';
const appId = 'io.github.raycrews.neoai';
const label = flatpak ? 'Flatpak' : 'AppImage';
const image = path.resolve(process.argv[2] || `dist/Neo-AI-${version}-linux-x86_64.AppImage`);
if (process.platform !== 'linux') throw new Error('Run this test on Linux.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-packaged-linux-'));
const home = path.join(scratch, 'home'), config = path.join(home, '.config');
const documents = path.join(home, 'Documents');
for (const dir of [home, config, documents]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(config, 'user-dirs.dirs'), `XDG_DOCUMENTS_DIR="${documents}"\n`);
const archive = flatpak
  ? path.join(execFileSync('flatpak', ['info', '--user', '--show-location', appId], { encoding: 'utf8' }).trim(), 'files/lib', appId, 'resources/app.asar')
  : path.resolve('dist/linux-unpacked/resources/app.asar');
const bundled = asar.listPackage(archive);
assert.equal(bundled.some(file => /\/(settings|library|book|ai-connections|secrets|profile-location)\.json$/.test(file)), false, 'personal data bundled');
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
assert.ok(bundled.some(file => /\/fonts\/.*\.woff2?$/.test(file)), 'bundled Linux fonts');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(100); }
  throw new Error('Timed out: ' + label);
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
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
let child, browser, page, log = '';
async function attach(endpoint) {
  const http = endpoint.replace('ws:', 'http:').split('/devtools/')[0];
  browser = await connect(endpoint);
  async function target(file) {
    const item = await until(async () => (await (await fetch(http + '/json/list')).json()).find(row => row.type === 'page' && row.url.endsWith('/' + file)), file);
    return connect(item.webSocketDebuggerUrl);
  }
  page = await target('index.html');
  await until(() => evaluate(page, 'typeof library !== "undefined" && !!library'), 'library loaded');
  return target;
}
// A host-side provider proves requests cross the Flatpak network boundary.
const provider = http.createServer(async (req, res) => {
  for await (const chunk of req) { /* Drain the request body. */ }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ data: [{ id: 'package-fixture' }] }));
  }
  if (req.url === '/v1/chat/completions') {
    res.setHeader('Content-Type', 'text/event-stream');
    return res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Packaged network reply.' } }] }) + '\n\ndata: [DONE]\n\n');
  }
  res.writeHead(404); res.end();
});
async function launch() {
  log = ''; let endpoint;
  const flags = ['--remote-debugging-port=0', '--ozone-platform=x11', '--disable-dev-shm-usage'];
  if (flatpak) flags.push('--inspect=0'); // Test-only access to stub the native picker.
  const isolated = { HOME: home, XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
  // Flatpak itself uses the build user's installation; only the application gets
  // this temporary profile. Neither package can touch a writer's settings/books.
  child = flatpak
    ? spawn('flatpak', ['run', '--user', '--filesystem=' + scratch,
      ...Object.entries(isolated).map(([key, value]) => `--env=${key}=${value}`), appId, ...flags],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(image, flags, { env: { ...process.env, ...isolated, APPIMAGE_EXTRACT_AND_RUN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    log += data.toString(); endpoint = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
  });
  await until(() => {
    if (child.exitCode !== null) throw new Error(label + ' exited: ' + log);
    return endpoint;
  }, 'packaged startup');
  return attach(endpoint);
}
async function close() {
  page?.close();
  await browser.send('Browser.close').catch(() => {}); browser.close();
  await until(() => child.exitCode !== null, 'app exits');
}
(async () => {
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  let target = await launch();
  assert.equal(await evaluate(page, 'window.neo.appVersion()'), version);
  assert.equal(await evaluate(page, 'document.querySelector("#firstrun").hidden'), false);
  assert.equal(await evaluate(page, 'library.authorName'), '');
  assert.equal(await evaluate(page, 'library.shelves.flatMap(s=>s.bookIds).length'), 0);
  await evaluate(page, `document.querySelector('#fr-name').value='Linux Test'; document.querySelector('#fr-step1 [data-style=pantser]').click(); document.querySelector('#fr-done').click(); undefined`);
  await until(() => evaluate(page, 'document.querySelector("#firstrun").hidden'), 'onboarding completed');
  const id = await evaluate(page, `(async () => {
    const meta = await window.neo.createBook({title:'Linux package test',author:'Linux Test'});
    meta.chapterOrder=['chapter-test']; await window.neo.writeBookMeta(meta.id,meta);
    await window.neo.writeChapter(meta.id,'chapter-test','<p>A <strong>saved</strong> Linux paragraph.</p>');
    library.shelves[0].bookIds.push(meta.id); await window.neo.writeLibrary(library);
    await openBook(meta.id); return meta.id;
  })()`);
  assert.match(await evaluate(page, 'document.querySelector(".chapter-body").innerHTML'), /<strong>saved<\/strong>/);
  await evaluate(page, 'window.neo.openSettings()'); const settings = await target('settings.html');
  assert.equal((await evaluate(settings, 'window.settingsAPI.read()')).profiles.length, 0);
  await evaluate(settings, `window.settingsAPI.save({name:'Host test provider',provider:'compatible',api:'chat',model:'package-fixture',baseUrl:'http://127.0.0.1:${provider.address().port}/v1',makeDefault:true})`);
  await evaluate(settings, 'window.settingsAPI.read().then(s=>window.settingsAPI.test(s.defaultId,"connection"))');
  await evaluate(settings, 'window.settingsAPI.saveAppearance({theme:"light",accent:"#639fe8"})');
  await evaluate(settings, 'window.settingsAPI.saveShortcut({id:"searchBook",accelerator:"Control+Shift+G"})');
  await evaluate(settings, 'window.settingsAPI.backupNow()');
  await evaluate(settings, 'window.close()').catch(() => {}); settings.close();
  await evaluate(page, 'switchTab("ai-assistance")');
  await until(() => evaluate(page, '!!window.neoChatView.current() && !window.neoChatView.requestBusy'), 'chat ready');
  await evaluate(page, `(() => { const v=window.neoChatView; v.draft.value='Reply to this package test'; v.draft.dispatchEvent(new Event('input')); return v.send(); })()`);
  await until(() => evaluate(page, 'window.neoChatView.current().messages.some(m=>m.role==="assistant" && m.content==="Packaged network reply.") && !window.neoChatView.state.job'), 'streamed AI reply');
  fs.mkdirSync('dist/test-results', { recursive: true });
  const screenshot = await page.send('Page.captureScreenshot');
  fs.writeFileSync(`dist/test-results/${label.toLowerCase()}.png`, Buffer.from(screenshot.data, 'base64'));
  const libraryDir = await evaluate(page, 'window.neo.libraryPath()');
  assert.ok(libraryDir.startsWith(home + path.sep), 'library isolated');
  await close();
  target = await launch();
  assert.equal(await evaluate(page, 'document.querySelector("#firstrun").hidden'), true);
  await evaluate(page, `openBook(${JSON.stringify(id)})`);
  assert.match(await evaluate(page, 'document.querySelector(".chapter-body").textContent'), /saved.*Linux/);
  assert.equal(await evaluate(page, 'window.neoAppearance.read().then(v=>v.theme)'), 'light');
  assert.equal(await evaluate(page, 'window.neo.shortcuts().then(rows=>rows.find(r=>r.id==="searchBook").accelerator)'), 'Control+Shift+G');
  assert.ok(fs.readdirSync(path.join(libraryDir, 'Backups')).some(file => file.endsWith('.zip')));
  if (flatpak) {
    // Exercise the real Settings -> Browse -> app.relaunch path. Only the OS
    // picker is replaced; app exit and Zypak restart are real packaged processes.
    const nextLibrary = path.join(scratch, 'second library'); fs.mkdirSync(nextLibrary);
    const mainEndpoint = log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
    assert.ok(mainEndpoint, 'test main-process inspector');
    const main = await connect(mainEndpoint);
    await evaluate(main, `process.mainModule.require('electron').dialog.showOpenDialog = async () => ({canceled:false,filePaths:[${JSON.stringify(nextLibrary)}]}); undefined`);
    main.close();
    await evaluate(page, 'window.neo.openSettings()');
    const switching = await target('settings.html');
    log = '';
    await evaluate(switching, 'void window.settingsAPI.browseLibrary()');
    switching.close(); page.close(); browser.close();
    const restarted = await until(() => log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1], 'automatic Flatpak restart');
    target = await attach(restarted);
    assert.equal(await evaluate(page, 'window.neo.libraryPath()'), nextLibrary);
    assert.ok(fs.existsSync(path.join(libraryDir, id, 'chapters/chapter-test.html')), 'original writing remains');
    console.log('PASS: Flatpak library switch automatically restarts through Zypak.');
  }
  await close();
  console.log('PASS: host AI connection through package network permissions.');
  console.log('PASS: packaged ' + label + ' first run, onboarding, formatted book, settings, backup, and persistence after restart. Sandbox enabled.');
})().catch(error => { console.error(error); console.error(log); process.exitCode = 1; })
  .finally(() => { provider.close(); page?.close(); browser?.close(); if (child && child.exitCode === null) child.kill('SIGTERM'); });
