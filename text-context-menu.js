// Native editing actions preserve the same rich clipboard data and undo behavior
// as keyboard shortcuts. Install for every window, including detached panes.
function installTextContextMenus({ app, BrowserWindow, Menu, t }) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_event, params) => {
      const window = BrowserWindow.fromWebContents(contents);
      if (!window || window.isDestroyed()) return;
      const template = textMenuTemplate(params, t);
      if (!template.length) return;
      Menu.buildFromTemplate(template).popup({
        window, frame: params.frame || undefined,
        x: params.x, y: params.y, sourceType: params.menuSourceType
      });
    });
  });
}

function textMenuTemplate({ isEditable, selectionText, editFlags = {} }, t = text => text) {
  if (!isEditable && !selectionText) return [];
  const item = (role, label, flag) => ({ role, label: t(label), enabled: !!editFlags[flag] });
  if (!isEditable) return [item('copy', 'Copy', 'canCopy'), { type: 'separator' }, item('selectAll', 'Select All', 'canSelectAll')];
  return [
    item('undo', 'Undo', 'canUndo'), item('redo', 'Redo', 'canRedo'),
    { type: 'separator' },
    item('cut', 'Cut', 'canCut'), item('copy', 'Copy', 'canCopy'),
    item('paste', 'Paste', 'canPaste'), item('pasteAndMatchStyle', 'Paste and Match Style', 'canPaste'),
    item('delete', 'Delete', 'canDelete'),
    { type: 'separator' }, item('selectAll', 'Select All', 'canSelectAll')
  ];
}

module.exports = { installTextContextMenus, textMenuTemplate };
