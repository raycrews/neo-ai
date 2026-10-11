// A portable Windows app runs inside a temporary extraction directory.
// Its launcher deletes that directory on exit, so relaunch the durable EXE.
function relaunchOptions({ platform = process.platform, env = process.env, argv = process.argv } = {}) {
  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_FILE) {
    return { execPath: env.PORTABLE_EXECUTABLE_FILE, args: argv.slice(1) };
  }
  // AppImage mounts its executable in a temporary directory. Restart the
  // original image so changing libraries still works after that mount closes.
  if (platform === 'linux' && env.APPIMAGE) {
    return { execPath: env.APPIMAGE, args: argv.slice(1) };
  }
  // Electron preserves the executable and arguments for installed/dev apps.
  return {};
}

module.exports = { relaunchOptions };
