const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');

test('Flatpak launcher selects actual display sockets before starting Electron', { skip: process.platform !== 'linux' }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-display-'));
  const socket = path.join(scratch, 'wayland-0');
  const server = net.createServer();
  fs.writeFileSync(path.join(scratch, 'zypak-wrapper'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const run = (env = {}, args = []) => execFileSync('/bin/sh', [path.resolve(__dirname, '../build/flatpak-launcher.sh'), ...args], {
    encoding: 'utf8', env: { PATH: scratch, FLATPAK_ID: 'test.neo', XDG_RUNTIME_DIR: scratch, XDG_SESSION_TYPE: 'wayland', ...env }
  }).trim().split('\n');
  try {
    assert.deepEqual(run(), ['neo-ai', '--ozone-platform=x11']);
    fs.writeFileSync(socket, 'not a socket');
    assert.equal(run()[1], '--ozone-platform=x11');
    fs.unlinkSync(socket);
    server.listen(socket); await once(server, 'listening');
    assert.equal(run()[1], '--ozone-platform=wayland');
    assert.equal(run({ WAYLAND_DISPLAY: socket })[1], '--ozone-platform=wayland');
    assert.equal(run({ WAYLAND_DISPLAY: 'missing' })[1], '--ozone-platform=x11');
    assert.deepEqual(run({}, ['--ozone-platform=x11', 'file with spaces']), ['neo-ai', '--ozone-platform=wayland', '--ozone-platform=x11', 'file with spaces']);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
