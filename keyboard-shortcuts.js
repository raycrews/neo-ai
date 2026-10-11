const definitions = [
  ['settings', 'Settings', 'CmdOrCtrl+,'],
  ['emailDraft', 'Email a draft to yourself', 'CmdOrCtrl+E'],
  ['import', 'Import manuscripts', 'CmdOrCtrl+Shift+I'],
  ['find', 'Find and replace', 'CmdOrCtrl+F'],
  ['searchBook', 'Search book', 'CmdOrCtrl+Shift+F'],
  ['spellcheck', 'Toggle spellcheck pass', 'CmdOrCtrl+;'],
  ['align:left', 'Align paragraph left', 'CmdOrCtrl+Shift+L'],
  ['align:center', 'Center paragraph', 'CmdOrCtrl+Shift+C'],
  ['align:right', 'Align paragraph right', 'CmdOrCtrl+Shift+R'],
  ['align:justify', 'Justify paragraph', 'CmdOrCtrl+Shift+J'],
  ['fontSize:1', 'Larger text', 'CmdOrCtrl+Plus'],
  ['fontSize:-1', 'Smaller text', 'CmdOrCtrl+Minus'],
  ['fontSize:0', 'Reset text size and page zoom', 'CmdOrCtrl+0'],
  ['typewriter', 'Toggle typewriter scrolling', 'CmdOrCtrl+Shift+T'],
  ['detachOutline', 'Open outline in separate window', 'CmdOrCtrl+Shift+U'],
  ['fullscreen', 'Toggle full screen', 'F11'],
  ['focusCycle', 'Cycle focus mode', 'CmdOrCtrl+Shift+O'],
  ['help', 'Keyboard shortcuts', 'CmdOrCtrl+/']
];
function defaults(platform = process.platform) {
  return definitions.map(([id, label, key]) => ({ id, label, default: key.replace('CmdOrCtrl', platform === 'darwin' ? 'Command' : 'Control'),
    ...(id === 'fullscreen' && platform === 'darwin' ? { default: 'Control+Command+F' } : {}) }));
}
function snapshot(overrides = {}, platform) {
  return defaults(platform).map(row => ({ ...row, accelerator: Object.hasOwn(overrides, row.id) ? overrides[row.id] : row.default }));
}
function normalize(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 80) throw new Error('Invalid shortcut.');
  const parts = value.split('+'); const key = parts.pop();
  if (!/^(?:[A-Z0-9,.;/\[\]'\\`=-]|Plus|Minus|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)) throw new Error('Use a letter, number, punctuation key, or F1–F24.');
  if (parts.some(p => !['Control', 'Command', 'Alt', 'Shift'].includes(p)) || new Set(parts).size !== parts.length) throw new Error('Invalid shortcut modifiers.');
  if (!/^F\d+$/.test(key) && !parts.some(p => ['Control', 'Command', 'Alt'].includes(p))) throw new Error('Include Ctrl, Command, or Alt so typing still works.');
  return [...['Control', 'Command', 'Alt', 'Shift'].filter(p => parts.includes(p)), key].join('+');
}
function validate(overrides, platform = process.platform) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid shortcuts.');
  const ids = new Set(definitions.map(d => d[0])); const result = {};
  for (const [id, key] of Object.entries(overrides)) { if (!ids.has(id)) throw new Error('Unknown shortcut.'); result[id] = normalize(key); }
  const mod = platform === 'darwin' ? 'Command' : 'Control';
  const reserved = new Set(['A','B','C','I','M','Q','S','U','V','W','X','Y','Z','Shift+Z','Shift+V','Alt+Shift+V','Shift+X','Shift+D','Alt+H','H'].map(key => normalize(mod + '+' + key)));
  reserved.add('Alt+F4');
  const seen = new Map();
  for (const row of snapshot(result, platform)) {
    const key = normalize(row.accelerator); if (!key) continue;
    if (reserved.has(key)) throw new Error('That shortcut is reserved for editing or window controls.');
    if (seen.has(key)) throw new Error('That shortcut is already used by ' + seen.get(key) + '. Clear it there first.');
    seen.set(key, row.label);
  }
  return result;
}
module.exports = { snapshot, validate, normalize };
