const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relaunchOptions } = require('../relaunch');

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
