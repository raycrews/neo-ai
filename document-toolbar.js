// One toolbar for document editors. Keep the selection while its controls have
// focus, and let native editing commands retain the editor's undo history.
(() => {
  const toolbar = document.querySelector('#document-formatting');
  const paper = document.querySelector('#paper-scroll');
  const editorSelector = '.chapter-body[contenteditable="true"], .tree-document-text[contenteditable="true"], #aux-editor[contenteditable="true"]';
  let saved = null;
  let refreshPending = false;
  const controls = [];
  const visible = element => element?.isConnected && !element.closest('[hidden]') && element.getClientRects().length > 0;
  const editors = () => [...paper.querySelectorAll(editorSelector)].filter(visible);
  function selectedEditor() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const editor = start?.closest(editorSelector);
    if (!visible(editor) || !editor.contains(range.endContainer)) return null;
    return { editor, range: range.cloneRange() };
  }
  function remember() {
    const current = selectedEditor();
    if (current) saved = current;
    else if (!toolbar.contains(document.activeElement)) saved = null;
  }
  function validSaved() {
    return saved && visible(saved.editor) && saved.editor.contains(saved.range.startContainer) && saved.editor.contains(saved.range.endContainer);
  }
  function refresh() {
    refreshPending = false;
    toolbar.hidden = editors().length === 0;
    if (!validSaved()) saved = null;
    const usable = !!saved;
    for (const control of controls) control.disabled = !usable;
    if (!usable) {
      toolbar.querySelectorAll('[aria-pressed]').forEach(button => button.setAttribute('aria-pressed', 'false'));
      return;
    }
    // Query the live selection only; a toolbar select can temporarily own focus.
    if (!selectedEditor()) return;
    toolbar.querySelectorAll('[data-command][aria-pressed]').forEach(button => {
      button.setAttribute('aria-pressed', String(document.queryCommandState(button.dataset.command)));
    });
    const block = String(document.queryCommandValue('formatBlock')).toLowerCase().replace(/[<>]/g, '');
    style.value = ['p', 'h1', 'h2', 'h3', 'blockquote'].includes(block) ? block : 'p';
    alignment.value = ['justifyCenter', 'justifyRight', 'justifyFull'].find(command => document.queryCommandState(command)) || 'justifyLeft';
  }
  function queueRefresh() {
    if (!refreshPending) { refreshPending = true; queueMicrotask(refresh); }
  }
  function apply(command, value = null) {
    if (!validSaved()) return;
    const { editor, range } = saved;
    const scroll = paper.scrollTop;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    // Semantic HTML keeps these documents usable outside Neo-AI.
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(command, false, value);
    remember(); refresh();
    paper.scrollTop = scroll;
    requestAnimationFrame(() => { paper.scrollTop = scroll; });
  }
  window.neoDocumentFormat = { align(value) {
    const command = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[value];
    if (command) { remember(); apply(command); }
  } };
  function select(label, options, onChange) {
    const element = document.createElement('select');
    element.setAttribute('aria-label', label); element.title = label;
    for (const [value, text] of options) element.add(new Option(text, value));
    element.addEventListener('change', () => onChange(element.value));
    controls.push(element); toolbar.append(element); return element;
  }
  const style = select('Paragraph style', [['p', 'Paragraph'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['blockquote', 'Quote']], value => apply('formatBlock', value));
  for (const [command, label, text] of [
    ['bold', 'Bold (Ctrl+B)', 'B'], ['italic', 'Italic (Ctrl+I)', 'I'],
    ['underline', 'Underline (Ctrl+U)', 'U'], ['strikeThrough', 'Strikethrough', 'S'],
    ['insertUnorderedList', 'Bulleted list', '• List'], ['insertOrderedList', 'Numbered list', '1. List']
  ]) {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.command = command; button.textContent = text;
    button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => apply(command));
    controls.push(button); toolbar.append(button);
  }
  const alignment = select('Text alignment', [['justifyLeft', 'Align left'], ['justifyCenter', 'Center'], ['justifyRight', 'Align right'], ['justifyFull', 'Justify']], value => apply(value));
  document.addEventListener('selectionchange', () => { remember(); queueRefresh(); });
  document.addEventListener('focusin', () => { remember(); queueRefresh(); });
  paper.addEventListener('input', queueRefresh);
  // Navigation replaces reference editors and hides manuscript/chat panels.
  new MutationObserver(queueRefresh).observe(paper, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'contenteditable'] });
  new MutationObserver(queueRefresh).observe(document.querySelector('#editor-view'), { attributes: true, attributeFilter: ['hidden'] });
  refresh();
})();
