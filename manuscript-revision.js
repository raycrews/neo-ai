// A captured selection belongs to one unchanged writing field. Native insertion
// makes acceptance a single undoable edit and keeps surrounding markup intact.
(() => {
  let saved = null, profiles = [], pending = null, serial = 0, completed = false;
  const dialog = document.createElement('dialog');
  dialog.id = 'manuscript-revision'; dialog.setAttribute('aria-labelledby', 'revision-title');
  dialog.innerHTML = `
    <header><h2 id="revision-title">Revise selected text</h2><button type="button" data-close>Cancel</button></header>
    <div class="revision-controls">
      <label>Action<select data-action></select></label>
      <label>Connection<select data-connection></select></label>
      <label>Model<input data-model maxlength="200" list="revision-models"><datalist id="revision-models"></datalist></label>
      <button type="button" data-settings>Connections…</button>
    </div>
    <p class="revision-hint">Uses the selected passage and up to 2,000 characters on either side from this document. Edit action instructions in Settings → AI.</p>
    <label class="revision-instruction">Additional instructions<textarea data-instruction rows="2" maxlength="4000" placeholder="Optional direction for this revision"></textarea></label>
    <div class="revision-comparison">
      <label>Original selection<textarea data-original readonly></textarea></label>
      <label>Proposed revision<textarea data-result placeholder="The proposed text will appear here. You can edit it before accepting." disabled></textarea></label>
    </div>
    <p data-status role="status" aria-live="polite"></p>
    <footer><span data-count></span><button type="button" data-generate>Generate</button><button type="button" data-accept disabled>Accept replacement</button></footer>`;
  document.body.append(dialog);
  const el = selector => dialog.querySelector(selector);
  const action = el('[data-action]'), connection = el('[data-connection]'), model = el('[data-model]');
  const instruction = el('[data-instruction]'), result = el('[data-result]'), status = el('[data-status]');
  action.append(...RevisionActions.map(item => new Option(item.name, item.id)));
  const unwrap = response => { if (response.error) throw new Error(response.error); return response.value; };
  const words = value => (value.trim().match(/\S+/g) || []).length;
  const sourceBook = () => typeof book !== 'undefined' ? book?.id : typeof snapshot !== 'undefined' ? snapshot?.bookId : null;
  const section = () => typeof currentTab !== 'undefined' ? currentTab : 'outline';
  const excluded = () => section() === 'darlings' || !!document.querySelector('.ai-chat:not([hidden]) .ai-transcript')?.getClientRects().length;
  const editorSelector = '.chapter-body[contenteditable="true"], .tree-document-text[contenteditable="true"], #aux-editor[contenteditable="true"], .ol-text[contenteditable="true"]';
  let contextAt = 0;
  function excerpt(range) {
    // Range.toString() joins adjacent paragraphs. Preserve their boundaries in
    // the nearby context without adding temporary nodes to the manuscript.
    function text(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      if (node.nodeName === 'BR') return '\n';
      const value = Array.from(node.childNodes, text).join('');
      return /^(P|DIV|LI|BLOCKQUOTE|H[1-6])$/.test(node.nodeName) ? '\n' + value + '\n' : value;
    }
    return text(range.cloneContents());
  }
  function controls() {
    for (const field of [action, connection, model, instruction, el('[data-settings]')]) field.disabled = !!pending;
    result.disabled = !!pending || !completed;
    el('[data-generate]').textContent = pending ? 'Stop' : completed ? 'Try again' : 'Generate';
    el('[data-generate]').disabled = !pending && (!profiles.length || !model.value.trim());
    el('[data-accept]').disabled = !!pending || !completed || !result.value.trim();
    el('[data-settings]').hidden = !window.neo?.openSettings;
    el('[data-count]').textContent = `${words(saved?.text || '')} words selected${completed ? ' · ' + words(result.value) + ' words proposed' : ''}`;
    instruction.required = action.value === 'custom';
    instruction.placeholder = instruction.required ? 'Describe the change you want' : 'Optional direction for this revision';
  }
  function capture() {
    if (dialog.open) return false;
    saved = null;
    if (dialog.open || document.querySelector('dialog[open]') || !sourceBook() || excluded()) return false;
    const field = document.activeElement;
    if (field?.matches('#outline textarea[data-key], .sticky textarea') && !field.disabled && !field.readOnly && field.selectionEnd > field.selectionStart && field.getClientRects().length && !field.closest('[hidden]')) {
      const start = field.selectionStart, end = field.selectionEnd, text = field.value.slice(start, end);
      if (!text.trim()) return false;
      saved = { body: field, text, value: field.value, start, end, bookId: sourceBook(), section: section(),
        before: field.value.slice(Math.max(0, start - 2000), start), after: field.value.slice(end, end + 2000) };
      return true;
    }
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) { saved = null; return false; }
    const range = selection.getRangeAt(0).cloneRange();
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const body = start?.closest(editorSelector);
    if (!body || !body.contains(range.endContainer) || !body.getClientRects().length || body.closest('[hidden]')) { saved = null; return false; }
    if (start.closest('.ghost,.ph-mark,[contenteditable="false"]') || range.cloneContents().querySelector('.ghost,.ph-mark,.scene-break,[data-sec-brk],[contenteditable="false"]')) { saved = null; return false; }
    const text = selection.toString();
    if (!text.trim()) { saved = null; return false; }
    const before = range.cloneRange(); before.selectNodeContents(body); before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange(); after.selectNodeContents(body); after.setStart(range.endContainer, range.endOffset);
    saved = { body, range, text, rangeText: range.toString(), html: body.innerHTML, bookId: sourceBook(), section: section(),
      before: excerpt(before).slice(-2000), after: excerpt(after).slice(0, 2000) };
    return true;
  }
  function valid() {
    if (!saved || excluded() || sourceBook() !== saved.bookId || section() !== saved.section) return false;
    if ('value' in saved) return saved.body.isConnected && saved.body.getClientRects().length && !saved.body.closest('[hidden]') && !saved.body.disabled && !saved.body.readOnly && saved.body.value === saved.value;
    return saved.body.isConnected && saved.body.getClientRects().length &&
      !saved.body.closest('[hidden]') && saved.body.innerHTML === saved.html &&
      saved.body.contains(saved.range.startContainer) && saved.body.contains(saved.range.endContainer) && saved.range.toString() === saved.rangeText;
  }
  function selectModel() {
    const profile = profiles.find(p => p.id === connection.value);
    model.value = profile?.model || '';
    el('datalist').replaceChildren(...(profile?.discoveredModels || []).map(item => new Option(item.id || item, item.id || item)));
    controls();
  }
  async function open(id) {
    if (!RevisionActions.some(item => item.id === id) || !valid() || dialog.open) return;
    const turn = ++serial;
    profiles = []; pending = null; completed = false;
    action.value = id; instruction.value = ''; result.value = ''; model.value = '';
    el('[data-original]').value = saved.text;
    status.textContent = 'Loading connections…'; controls(); dialog.showModal();
    try {
      const state = unwrap(await neoRevisionAPI.connections());
      if (!dialog.open || turn !== serial) return;
      profiles = state.profiles;
      connection.replaceChildren(...profiles.map(p => new Option(p.name, p.id)));
      connection.value = profiles.some(p => p.id === state.defaultId) ? state.defaultId : profiles[0]?.id || '';
      selectModel();
      status.textContent = profiles.length ? 'Review the action and connection, then generate a revision.' : 'Add a connection in Settings → AI Connections, then reopen this preview.';
      if (id === 'custom') instruction.focus(); else el('[data-generate]').focus();
    } catch (error) { if (dialog.open && turn === serial) status.textContent = error.message; }
  }
  async function stop() {
    const id = pending; ++serial;
    if (id) await neoRevisionAPI.cancel(id);
    if (pending === id) { pending = null; controls(); }
  }
  function closePreview() { void stop(); dialog.close(); }
  async function generate() {
    if (pending) { await stop(); status.textContent = 'Revision stopped. The original text is unchanged.'; return; }
    if (!valid()) { status.textContent = 'The document changed. Close this preview and select the passage again.'; return; }
    if (action.value === 'custom' && !instruction.value.trim()) { status.textContent = 'Describe the change you want.'; instruction.focus(); return; }
    const turn = ++serial, id = crypto.randomUUID(); pending = id; completed = false; result.value = ''; controls();
    status.textContent = 'Generating a revision…';
    try {
      const text = unwrap(await neoRevisionAPI.generate({ requestId: id, bookId: saved.bookId,
        action: action.value, profileId: connection.value, model: model.value.trim(),
        selection: saved.text, before: saved.before, after: saved.after, instruction: instruction.value }));
      if (turn !== serial || !dialog.open) return;
      result.value = text; completed = true;
      status.textContent = 'Review or edit the proposal, then accept it or try again.';
    } catch (error) { if (turn === serial && dialog.open) status.textContent = error.message; }
    finally { if (pending === id) pending = null; controls(); }
  }
  function accept() {
    if (pending || !completed || !result.value.trim()) return;
    if (!valid()) { status.textContent = 'The document changed. Close this preview and select the passage again.'; el('[data-accept]').disabled = true; return; }
    const { body, range } = saved, text = result.value;
    // Close first so the modal no longer makes the manuscript inert.
    closePreview(); body.focus({ preventScroll: true });
    if ('value' in saved) {
      body.setSelectionRange(saved.start, saved.end);
      document.execCommand('insertText', false, text);
      body.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    if (body.matches('.ol-text')) document.execCommand('insertText', false, text.replace(/[\r\n]+/g, ' '));
    else if (!/[\r\n]/.test(text)) document.execCommand('insertText', false, text);
    else {
      // Native insertText treats each newline as a new paragraph and can add
      // blank paragraphs. Build safe HTML from text nodes, retaining single
      // line breaks within a paragraph and blank lines between paragraphs.
      const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
      const html = blocks.map(block => {
        const p = document.createElement('p');
        block.split('\n').forEach((line, index) => {
          if (index) p.append(document.createElement('br'));
          p.append(document.createTextNode(line));
        });
        return blocks.length > 1 ? p.outerHTML : p.innerHTML;
      }).join('');
      document.execCommand('insertHTML', false, html);
    }
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el('[data-close]').onclick = closePreview;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
  dialog.addEventListener('close', () => { if (!dialog.open) void stop(); });
  el('[data-settings]').onclick = () => window.neo.openSettings();
  el('[data-generate]').onclick = generate; el('[data-accept]').onclick = accept;
  connection.onchange = selectModel;
  action.onchange = () => { completed = false; result.value = ''; controls(); };
  model.oninput = controls; result.oninput = controls;
  // Capture during the DOM event, before the native menu takes focus. Reading
  // the selection later over IPC can miss it on some platforms/window states.
  document.addEventListener('contextmenu', event => {
    contextAt = 0;
    if (dialog.open) return;
    if (capture() && (saved.body.contains(event.target) || saved.body === event.target)) contextAt = performance.now();
    else saved = null;
  }, true);
  window.neoRevision = { capture, contextSelection: () => contextAt > 0 && performance.now() - contextAt < 2000 && valid() };
  neoRevisionAPI.onOpen(open);
})();
