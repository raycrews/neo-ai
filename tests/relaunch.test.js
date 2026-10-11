const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relaunchOptions } = require('../relaunch');

test('Flatpak restarts through Zypak, even with inherited AppImage variables', () => {
  assert.deepEqual(relaunchOptions({ platform: 'linux',
    env: { FLATPAK_ID: 'io.github.raycrews.neoai', APPIMAGE: '/irrelevant.AppImage' },
    argv: ['/app/lib/io.github.raycrews.neoai/neo-ai', '--lang=en-US'] }), {
    execPath: '/app/bin/electron-wrapper', args: ['--lang=en-US']
  });
});

test('portable Windows restarts the launcher rather than the extracted app', () => {
  const argv = ['C:\\Temp\\ns123\\app\\Neo-AI.exe', '--lang=en-US'];
  assert.deepEqual(relaunchOptions({ platform: 'win32',
    env: { PORTABLE_EXECUTABLE_FILE: 'C:\\My Apps\\Neo-AI.exe' }, argv }), {
    execPath: 'C:\\My Apps\\Neo-AI.exe', args: ['--lang=en-US']
  });
  assert.equal(argv.length, 2);
});

test('installed Windows and development runs use Electron default relaunch', () => {
  assert.deepEqual(relaunchOptions({ platform: 'win32', env: {}, argv: ['electron', '.'] }), {});
});

test('macOS and Linux keep their existing relaunch behavior', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(relaunchOptions({ platform,
      env: { PORTABLE_EXECUTABLE_FILE: 'irrelevant.exe' }, argv: ['app'] }), {});
  }
});

test('portable packages extract to a new directory on each launch', () => {
  // Prevent the exiting launcher from deleting a newly restarted app's files.
  assert.equal(require('../package.json').build.portable.unpackDirName, true);
});

test('AppImage restarts the durable image with its arguments', () => {
  assert.deepEqual(relaunchOptions({ platform: 'linux',
    env: { APPIMAGE: '/home/writer/My Apps/Neo-AI.AppImage' }, argv: ['/tmp/.mount_neo/neo-ai', '--lang=en-US'] }), {
    execPath: '/home/writer/My Apps/Neo-AI.AppImage', args: ['--lang=en-US']
  });
});
