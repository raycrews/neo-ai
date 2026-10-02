// Adapter between the existing manuscript editor and native pane windows.
// Keep one editor responsible for book mutations and its undo history.
let panePublishTimer;
let paneSnapshotSignature = '';
let outlineDetached = false;
let contextRevision = 0;

function publishPaneState() {
  clearTimeout(panePublishTimer);
  const state = book ? {
    bookId: book.id, title: book.title, currentChapterId, contextRevision,
    chats: workspaceChatNodes().map(({ node, section }) => ({ id: node.conversationId, nodeId: node.id, section })),
    theme: library.pageTheme || 'night',
    chapters: book.chapterOrder.map((id, index) => ({
      id, title: book.chapterTitles?.[id] || t('Chapter {n}', { n: index + 1 }),
      note: book.chapterNotes?.[id] || '', words: chapterWords(id),
      sections: (book.sectionNotes?.[id] || []).map((s) => ({ id: s.id, text: s.text }))
    }))
  } : null;
  const signature = JSON.stringify(state);
  if (signature !== paneSnapshotSignature) {
    paneSnapshotSignature = signature;
    window.neo.publishPaneState(state);
  }
}
function schedulePaneState() {
  contextRevision++;
  clearTimeout(panePublishTimer);
  panePublishTimer = setTimeout(publishPaneState, 100);
}
async function detachOutline() {
  if (!book) { toast(t('Open a book first')); return; }
  document.activeElement?.blur();
  publishPaneState();
  try {
    await window.neo.openPane('outline');
    if (currentTab === 'outline') switchTab('manuscript');
  } catch (error) { toast(error.message, 7000); }
}

const detachButton = document.createElement('button');
detachButton.id = 'detach-outline';
detachButton.hidden = true;
detachButton.textContent = 'Open in separate window';
detachButton.title = 'Keep your outline beside the manuscript (Ctrl/Cmd+Shift+U)';
detachButton.onclick = detachOutline;
$('#aux-paper').insertBefore(detachButton, $('#aux-title'));
window.neo.onPaneState(({ detached }) => {
  outlineDetached = detached.includes('outline');
  detachButton.textContent = outlineDetached ? 'Show outline window' : 'Open in separate window';
});

// Compare field values, not the whole book revision: unrelated typing in the
// manuscript must never invalidate a note edit. Conflicts preserve the draft.
function checkPaneEdit(actual, expected) {
  if (actual !== expected) throw new Error('This note changed in the workspace. Review the latest text before applying your draft.');
}
window.neo.onPaneCommand(async ({ id, command, expiresAt }) => {
  let result = true;
  try {
    if (Date.now() > expiresAt) throw new Error('This action expired. Please try again.');
    if (command.type === 'flush') {
      if (window.neoChatView) await window.neoChatView.flush();
      await flushAllSaves();
    } else if (command.type === 'chatContext') {
      result = liveChatContext(command.bookId);
    } else if (command.type === 'syncChats') {
      result = await syncWorkspaceChats(command.bookId, command.conversations);
    } else if (command.type === 'exportChat') {
      result = await saveChatToNotes(command.bookId, command.node);
    } else if (command.type === 'dock') {
      if (book) switchTab(command.kind === 'ai-assistance' ? 'ai-assistance' : 'outline');
    } else {
      if (!book || book.id !== command.bookId) throw new Error('The open book changed. Your draft is still in the outline window.');
      const chId = command.chapterId;
      if (command.type !== 'addChapter' && !book.chapterOrder.includes(chId)) throw new Error('That chapter no longer exists.');
      book.chapterNotes ||= {};
      book.sectionNotes ||= {};
      if (command.type === 'navigate') {
        switchTab('manuscript');
        focusChapter(chId);
      } else if (command.type === 'chapterNote' || command.type === 'sectionNote') {
        if (typeof command.text !== 'string' || typeof command.expected !== 'string') throw new Error('Invalid note');
        let section;
        if (command.type === 'chapterNote') checkPaneEdit(book.chapterNotes[chId] || '', command.expected);
        else {
          section = (book.sectionNotes[chId] || []).find((s) => s.id === command.sectionId);
          if (!section) throw new Error('That section no longer exists.');
          checkPaneEdit(section.text || '', command.expected);
        }
        // Commit the note on disk before acknowledging it to the pane.
        if (section) section.text = command.text;
        else book.chapterNotes[chId] = command.text;
        await saveMeta();
        if (section) syncGhosts(chId);
        if (currentTab === 'outline') {
          const line = [...document.querySelectorAll('.ol-line')].find((el) =>
            el.dataset.chId === chId && (command.sectionId ? el.dataset.secId === command.sectionId : !el.dataset.secId));
          // A field can remain document.activeElement after its window loses
          // focus. Update it too, or its next blur could restore stale text.
          if (line) line.querySelector('.ol-text').textContent = command.text;
        }
        renderNav();
      } else if (command.type === 'addChapter') {
        snapshotStructure('chapter add');
        createChapterAt(book.chapterOrder.length);
        if (currentTab === 'outline') renderOutline();
      } else if (command.type === 'addSection') {
        snapshotStructure('section add');
        (book.sectionNotes[chId] ||= []).push({ id: 'sec-' + crypto.randomUUID(), text: '' });
        await saveMeta();
        if (currentTab === 'outline') renderOutline();
      } else throw new Error('Unknown outline action');
      await flushAllSaves();
    }
    publishPaneState();
    window.neo.replyPaneCommand({ id, result });
  } catch (error) {
    publishPaneState();
    window.neo.replyPaneCommand({ id, error: error.message });
  }
});
schedulePaneState();
