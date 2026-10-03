// Publish only the capabilities the native menu needs, never document contents.
(() => {
  let last = '', pending = false;
  const visible = element => !!element?.isConnected && !element.closest('[hidden]') && element.getClientRects().length > 0;
  function publish() {
    pending = false;
    const openBook = !!book && visible(document.querySelector('#editor-view'));
    const manuscript = openBook && currentTab === 'manuscript' && [...document.querySelectorAll('.chapter-body')].some(visible);
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    const start = range && (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement);
    const editor = start?.closest('.chapter-body[contenteditable="true"], .tree-document-text[contenteditable="true"], #aux-editor[contenteditable="true"]');
    const active = document.activeElement;
    const selection = openBook && visible(editor) && !!range && editor.contains(range.endContainer) &&
      (editor.contains(active) || !!active?.closest('#document-formatting'));
    const state = {
      ready: !!library, book: openBook, manuscript, selection,
      manuscriptSelection: selection && editor.matches('.chapter-body'),
      spellcheck: manuscript || (openBook && visible(document.querySelector('#aux-editor'))),
      modal: [...document.querySelectorAll('dialog[open], .modal-backdrop')].some(visible)
    };
    const signature = JSON.stringify(state);
    if (signature !== last) { last = signature; window.neo.menuState(state); }
  }
  function schedule() { if (!pending) { pending = true; queueMicrotask(publish); } }
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'contenteditable'] });
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('focusin', schedule);
  window.addEventListener('focus', schedule);
  publish();
})();
