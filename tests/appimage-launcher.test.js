const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const afterPack = require('../build/after-pack.cjs');
const asar = require('@electron/asar');

async function addArchive(root) {
  const source = path.join(root, 'fixture-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'main.js'), '// fixture');
  await asar.createPackage(source, path.join(root, 'app.asar'));
  await fs.rm(source, { recursive: true });
}

test('packaging hook checks Windows, macOS, and Flatpak without adding an AppImage launcher', async t => {
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-hook-'));
  t.after(() => fs.rm(appOutDir, { recursive: true, force: true }));
  await addArchive(appOutDir);
  for (const [electronPlatformName, name] of [['win32', 'nsis'], ['darwin', 'dmg'], ['linux', 'flatpak']]) {
    await afterPack({ electronPlatformName, targets: [{ name }], appOutDir });
    assert.deepEqual(await fs.readdir(appOutDir), ['app.asar']);
  }
});

test('packaged AppImage launcher selects a real display and preserves user arguments',
  { skip: process.platform !== 'linux' }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-launcher-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const appOutDir = path.join(root, "App's folder");
    await fs.mkdir(appOutDir);
    await addArchive(appOutDir);
    await fs.writeFile(path.join(appOutDir, 'neo-ai'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    await afterPack({ electronPlatformName: 'linux', targets: [{ name: 'appImage' }], appOutDir });
    const launch = (env, args = []) => execFileSync(path.join(appOutDir, 'neo-ai'), args, {
      env: { ...process.env, XDG_RUNTIME_DIR: root, WAYLAND_DISPLAY: 'wayland-test', ...env },
      encoding: 'utf8',
    }).trim().split('\n');
    assert.deepEqual(launch({ XDG_SESSION_TYPE: 'wayland' }), ['--ozone-platform=x11']);
    const socketPath = path.join(root, 'wayland-test');
    await fs.writeFile(socketPath, 'not a socket');
    assert.deepEqual(launch({}), ['--ozone-platform=x11']);
    await fs.unlink(socketPath);
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    assert.deepEqual(launch({}), ['--ozone-platform=wayland']);
    assert.deepEqual(launch({ WAYLAND_DISPLAY: socketPath, XDG_RUNTIME_DIR: '' }), ['--ozone-platform=wayland']);
    assert.deepEqual(launch({}, ['--ozone-platform=x11', '--user-data-dir=/tmp/my profile']),
      ['--ozone-platform=wayland', '--ozone-platform=x11', '--user-data-dir=/tmp/my profile']);
    assert.deepEqual(launch({ XDG_RUNTIME_DIR: '' }), ['--ozone-platform=x11']);
  });
