const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux' ||
      !context.targets.some(target => target.name.toLowerCase() === 'appimage')) return;
  const executable = path.join(context.appOutDir, 'neo-ai');
  await fs.rename(executable, path.join(context.appOutDir, 'neo-ai-bin'));
  for (const [source, destination] of [
    ['appimage-launcher.sh', 'neo-ai'],
    ['flatpak-display.sh', 'neo-display-backend'],
  ]) {
    const content = await fs.readFile(path.join(__dirname, source), 'utf8');
    const output = path.join(context.appOutDir, destination);
    await fs.writeFile(output, content.replace(/\r\n/g, '\n'), { mode: 0o755 });
    await fs.chmod(output, 0o755);
  }
};
