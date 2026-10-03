// Exercise the actual packaged executable with an isolated home, not Electron's
// development harness. No personal library, network AI, or email is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const asar = require('@electron/asar');
const version = require('../package.json').version;
const image = path.resolve(process.argv[2] || `dist/Neo-AI-${version}-linux-x86_64.AppImage`);
if (process.platform !== 'linux') throw new Error('Run this test on Linux.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-appimage-'));
const home = path.join(scratch, 'home'), config = path.join(home, '.config');
const documents = path.join(home, 'Documents');
for (const dir of [home, config, documents]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(config, 'user-dirs.dirs'), `XDG_DOCUMENTS_DIR="${documents}"\n`);
const archive = path.resolve('dist/linux-unpacked/resources/app.asar');
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
async function launch() {
  log = ''; let endpoint;
  child = spawn(image, ['--remote-debugging-port=0', '--ozone-platform=x11', '--disable-dev-shm-usage'], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache'),
      // CI does not provide a FUSE mount. This is the runtime's standard fallback;
      // Chromium's security sandbox remains enabled.
      APPIMAGE_EXTRACT_AND_RUN: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    log += data.toString(); endpoint = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
  });
  await until(() => {
    if (child.exitCode !== null) throw new Error('AppImage exited: ' + log);
    return endpoint;
  }, 'packaged startup');
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
async function close() {
  page?.close();
  await browser.send('Browser.close').catch(() => {}); browser.close();
  await until(() => child.exitCode !== null, 'app exits');
}
(async () => {
  let target = await launch();
  assert.equal(await evaluate(page, 'window.neo.appVersion()'), version);
  assert.equal(await evaluate(page, 'document.querySelector("#firstrun").hidden'), false);
  assert.equal(await evaluate(page, 'library.authorName'), '');
  assert.equal(await evaluate(page, 'library.shelves.flatMap(s=>s.bookIds).length'), 0);
  await evaluate(page, `document.querySelector('#fr-name').value='Linux Test'; document.querySelector('#fr-step1 [data-style=pantser]').click(); document.querySelector('#fr-done').click(); undefined`);
  await until(() => evaluate(page, 'document.querySelector("#firstrun").hidden'), 'onboarding completed');
  const id = await evaluate(page, `(async () => {
    const meta = await window.neo.createBook({title:'AppImage test',author:'Linux Test'});
    meta.chapterOrder=['chapter-test']; await window.neo.writeBookMeta(meta.id,meta);
    await window.neo.writeChapter(meta.id,'chapter-test','<p>A <strong>saved</strong> Linux paragraph.</p>');
    library.shelves[0].bookIds.push(meta.id); await window.neo.writeLibrary(library);
    await openBook(meta.id); return meta.id;
  })()`);
  assert.match(await evaluate(page, 'document.querySelector(".chapter-body").innerHTML'), /<strong>saved<\/strong>/);
  await evaluate(page, 'window.neo.openSettings()'); const settings = await target('settings.html');
  assert.equal((await evaluate(settings, 'window.settingsAPI.read()')).profiles.length, 0);
  await evaluate(settings, 'window.settingsAPI.saveAppearance({theme:"light",accent:"#639fe8"})');
  await evaluate(settings, 'window.settingsAPI.saveShortcut({id:"searchBook",accelerator:"Control+Shift+G"})');
  await evaluate(settings, 'window.settingsAPI.backupNow()');
  await evaluate(settings, 'window.close()').catch(() => {}); settings.close();
  fs.mkdirSync('dist/test-results', { recursive: true });
  const screenshot = await page.send('Page.captureScreenshot');
  fs.writeFileSync('dist/test-results/appimage.png', Buffer.from(screenshot.data, 'base64'));
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
  await close();
  console.log('PASS: packaged AppImage first run, onboarding, formatted book, settings, backup, and persistence after restart. Sandbox enabled.');
})().catch(error => { console.error(error); console.error(log); process.exitCode = 1; })
  .finally(() => { page?.close(); browser?.close(); if (child && child.exitCode === null) child.kill('SIGTERM'); });
