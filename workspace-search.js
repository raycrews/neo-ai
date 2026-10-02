(() => {
  const dialog = document.createElement('dialog'); dialog.id = 'book-search-dialog';
  dialog.setAttribute('aria-labelledby', 'book-search-heading');
  dialog.innerHTML = `<header><h2 id="book-search-heading">Search book</h2><button type="button" id="book-search-close">Close</button></header>
    <p id="book-search-description"></p>
    <div class="book-search-controls"><label>Search text<input id="book-search-query" type="search" maxlength="200" placeholder="Find words or a phrase…" autocomplete="off"></label>
    <label>Section<select id="book-search-section"><option value="">All sections</option></select></label></div>
    <p id="book-search-status" role="status" aria-live="polite"></p><div id="book-search-results" aria-label="Search results"></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), section = dialog.querySelector('select');
  const status = dialog.querySelector('#book-search-status'), results = dialog.querySelector('#book-search-results');
  let rows = [], bookId = null, revision = 0, timer, loading = false, chatError = '';
  for (const [value, label] of Object.entries(BookSearch.labels)) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; section.append(option);
  }
  function marked(element, text) {
    const expression = BookSearch.matcher(input.value); let remaining = text || '';
    let match;
    while (expression && (match = expression.exec(remaining))) {
      element.append(document.createTextNode(remaining.slice(0, match.index)));
      const mark = document.createElement('mark'); mark.textContent = match[0]; element.append(mark);
      remaining = remaining.slice(match.index + match[0].length);
    }
    element.append(document.createTextNode(remaining));
  }
  function render() {
    if (!dialog.open || loading) return;
    results.replaceChildren();
    if (!input.value.trim()) { status.textContent = 'Search document titles, text and AI chat messages.' + chatError; return; }
    const found = BookSearch.search(rows, input.value, section.value);
    status.textContent = (found.total ? (found.total > found.results.length ? `Showing the first ${found.results.length} of ${found.total} results. Narrow your search to see more.` : `${found.total} result${found.total === 1 ? '' : 's'}.`) : 'No matches in this book.') + chatError;
    for (const row of found.results) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'book-search-result';
      const heading = document.createElement('strong'); marked(heading, row.path);
      button.append(heading);
      if (row.speaker) { const speaker = document.createElement('small'); speaker.textContent = row.speaker; button.append(speaker); }
      const preview = document.createElement('span'); marked(preview, row.preview || 'Matched the title or folder name.'); button.append(preview);
      button.onclick = () => openResult(row).catch(error => { status.textContent = error.message; });
      results.append(button);
    }
  }
  async function openResult(row) {
    if (!book || book.id !== bookId) { dialog.close(); return; }
    const requestedBookId = bookId;
    if (row.conversationId) {
      // Sync older chat entries before navigating, using the existing chat lifecycle.
      const reply = await window.neoChat.read(requestedBookId);
      if (reply.error) throw new Error(reply.error);
      if (book?.id !== requestedBookId || bookId !== requestedBookId || !dialog.open) return;
      const match = workspaceChatNodes().find(item => item.node.conversationId === row.conversationId);
      if (!match) throw new Error('This chat has been removed from the workspace. Search again.');
      dialog.close();
      window.neoChatView.searchTarget = row.messageId ? { id: row.conversationId, messageId: row.messageId } : null;
      openWorkspaceNode(match.section, match.node.id);
    } else if (row.kind === 'aux' || row.kind === 'darling' || row.kind === 'outline') {
      dialog.close(); switchTab(row.section);
      if (row.kind === 'outline') renderOutline({ chId: row.chapterId, secId: row.sectionId });
      if (row.kind === 'darling') {
        const index = darlings.findIndex(d => d.id === row.id);
        document.querySelectorAll('#darlings-list .darling')[index]?.scrollIntoView({ block: 'center' });
      }
    } else {
      if (!WorkspaceTree.find(book.workspaceTree[row.section], row.id)) throw new Error('This document has moved or been removed. Reopen search to refresh the results.');
      dialog.close(); openWorkspaceNode(row.section, row.id);
    }
  }
  window.openBookSearch = async () => {
    if (!book || document.querySelector('#editor-view').hidden) { toast('Open a book first.'); return; }
    if (document.querySelector('dialog[open]') && !dialog.open) return;
    if (bookId !== book.id) { input.value = ''; section.value = ''; }
    bookId = book.id; const current = ++revision, openedBook = bookId;
    loading = true; chatError = ''; results.replaceChildren(); status.textContent = 'Reading this book…';
    dialog.querySelector('#book-search-description').textContent = book.title;
    if (!dialog.open) dialog.showModal(); input.focus(); input.select();
    publishPaneState();
    let conversations = [], notes = '';
    try {
      const reply = await window.neoChat.searchSnapshot(openedBook);
      if (reply.error) throw new Error(reply.error);
      conversations = reply.value;
    } catch (error) { chatError = ' Chats could not be searched: ' + error.message; }
    try {
      const editor = document.querySelector('#aux-editor');
      notes = currentTab === 'notes' && !editor.hidden ? editor.innerHTML : await window.neo.readAux(openedBook, 'notes');
    } catch (_) { chatError += ' The section Notes text could not be read.'; }
    if (revision !== current || book?.id !== openedBook || !dialog.open) return;
    WorkspaceTree.reconcile(book);
    rows = BookSearch.catalog(book, id => {
      const body = [...document.querySelectorAll('.chapter')].find(node => node.dataset.id === id)?.querySelector('.chapter-body');
      return body?.innerHTML ?? chapterHTML[id] ?? '';
    }, contextPlainText, conversations, source => contextPlainText(ChatMarkdown.render(source || '')));
    if (contextPlainText(notes)) rows.push({ kind: 'aux', section: 'notes', path: 'Notes / Section notes', text: contextPlainText(notes) });
    for (const d of darlings) rows.push({ id: d.id, kind: 'darling', section: 'darlings', path: 'Darlings / ' + (d.chapterLabel || 'Saved passage'), text: d.html ? contextPlainText(d.html) : d.text });
    for (const id of book.chapterOrder) {
      const title = book.chapterTitles?.[id] || 'Chapter ' + (book.chapterOrder.indexOf(id) + 1);
      if (book.chapterNotes?.[id]) rows.push({ kind: 'outline', section: 'outline', chapterId: id, path: 'Outline / ' + title, text: book.chapterNotes[id] });
      for (const note of book.sectionNotes?.[id] || []) rows.push({ kind: 'outline', section: 'outline', chapterId: id, sectionId: note.id, path: 'Outline / ' + title + ' / Section note', text: note.text });
    }
    loading = false; render();
  };
  dialog.querySelector('#book-search-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { revision++; clearTimeout(timer); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  section.onchange = render;
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); render(); results.querySelector('button')?.click(); }
  });
  results.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? document.activeElement.nextElementSibling : document.activeElement.previousElementSibling;
    if (next) next.focus(); else if (event.key === 'ArrowUp') input.focus();
  });
  const searchButton = document.querySelector('#workspace-search');
  searchButton.title = 'Search this book (' + (IS_MAC ? 'Cmd' : 'Ctrl') + '+Shift+F)';
  searchButton.onclick = window.openBookSearch;
})();
