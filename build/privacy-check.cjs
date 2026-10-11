const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep these aligned with .gitignore and build.files in package.json.
// Match filenames, never print or inspect private file contents.
const dataNames = [
  'library.json', 'book.json', 'ai-chats.json', 'darlings.json',
  'stickies.json', 'art.json', 'settings.json', 'secrets.json',
  'ai-connections.json', 'ai-assistants.json', 'instruction-library.json',
  'profile-location.json', 'fresh-setup-request',
];
const directoryNames = new Set([
  'neo library', 'neo-ai library', 'backups', 'exports',
  'userdata', 'profiles', '.aws', '.ssh',
]);

function isPrivatePath(file) {
  const parts = file.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  const name = parts.at(-1) || '';
  return parts.some((part, i) => i < parts.length - 1 && (
    directoryNames.has(part) || part.startsWith('neo-ai library-') || part.startsWith('book-')
  )) || dataNames.some(base => name === base || name.startsWith(base + '.')) ||
    name === '.env' || name.startsWith('.env.') ||
    /^neo-(backup|manual)-.*\.zip$/.test(name) ||
    /\.(p12|pfx|key|pem|keystore)$/.test(name) || /^id_(rsa|ed25519|ecdsa)(\.|$)/.test(name);
}

function assertSafePaths(files, label) {
  const rejected = [...new Set(files.filter(isPrivatePath))].sort();
  if (rejected.length) {
    // JSON escaping also prevents filenames containing terminal control characters.
    throw new Error(`${label} contains possible personal data files:\n` +
      rejected.map(file => '  ' + JSON.stringify(file)).join('\n') +
      '\nKeep personal data outside the source tree. No files were changed.');
  }
}

function checkRepository(root = path.resolve(__dirname, '..')) {
  // --cached includes force-added ignored files. -z handles spaces and newlines.
  const files = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  assertSafePaths(files, 'Git index');
  return files.length;
}

async function checkPackage(root) {
  const asar = require('@electron/asar');
  const files = [];
  let archives = 0;
  function walk(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + item.name;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) walk(absolute, relative + '/');
      else {
        files.push(relative);
        if (item.isSymbolicLink()) {
          // Mac framework symlinks are internal; refuse links outside the build.
          const target = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
          if (target === '..' || target.startsWith('..' + path.sep) || path.isAbsolute(target)) {
            throw new Error('Package contains an external symlink: ' + JSON.stringify(relative));
          }
        } else if (item.name.endsWith('.asar')) {
          archives++;
          asar.uncache(absolute);
          files.push(...asar.listPackage(absolute).map(name => relative + '/' + name.replace(/^[/\\]+/, '')));
        }
      }
    }
  }
  walk(root);
  if (!archives) throw new Error('Privacy check expected an ASAR archive in the packaged application.');
  assertSafePaths(files, 'Application package');
  return files.length;
}

module.exports = { isPrivatePath, assertSafePaths, checkRepository, checkPackage };
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (!args.length) console.log(`Privacy check passed: ${checkRepository()} tracked files.`);
    else if (args.length === 2 && args[0] === '--package') {
      console.log(`Privacy check passed: ${await checkPackage(path.resolve(args[1]))} package entries.`);
    } else throw new Error('Usage: node build/privacy-check.cjs [--package directory]');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
