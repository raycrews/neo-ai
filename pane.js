// This renderer has only pane IPC capabilities, no library/file APIs.
const api = window.neoPane;
const $ = (selector) => document.querySelector(selector);
let snapshot = null;
let renderedStructure = '';
let running = null;
let blocked = false;
let timer;
let closing = false;
const drafts = new Map();
const keyFor = (chapterId, sectionId) => JSON.stringify([chapterId, sectionId || null]);

function showError(error) {
  blocked = true;
  $('#error').textContent = error.message || String(error);
  $('#error-box').hidden = false;
  $('#recovery').value = [...drafts.values()].map((d) => d.text).join('\n\n');
  $('#status').textContent = 'Edits need attention';
}
function currentText(draft) {
  const chapter = snapshot?.chapters.find((ch) => ch.id === draft.chapterId);
  if (!chapter) return undefined;
  return draft.sectionId ? chapter.sections.find((s) => s.id === draft.sectionId)?.text : chapter.note;
}
function noteField(chapter, section) {
  const key = keyFor(chapter.id, section?.id);
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  const field = document.createElement('textarea');
  field.id = 'note-' + chapter.id + (section ? '-' + section.id : '');
  field.dataset.key = key;
  field.value = drafts.get(key)?.text ?? (section ? section.text : chapter.note);
  label.htmlFor = field.id;
  label.textContent = section ? 'Section ' + (chapter.sections.indexOf(section) + 1) : 'Chapter summary';
  field.addEventListener('input', () => {
    let draft = drafts.get(key);
    if (!draft) {
      draft = { bookId: snapshot.bookId, chapterId: chapter.id, sectionId: section?.id,
        type: section ? 'sectionNote' : 'chapterNote', expected: currentText({ chapterId: chapter.id, sectionId: section?.id }) };
      drafts.set(key, draft);
    }
    draft.text = field.value;
    $('#status').textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(showError), 200);
  });
  field.addEventListener('blur', () => { if (!blocked) flush().catch(showError); });
  wrap.append(label, field);
  return wrap;
}
function render() {
  if (drafts.size && [...drafts.values()].some((d) => d.bookId !== snapshot?.bookId)) {
    showError(new Error('The book changed before these edits were saved. Copy your draft, then discard it to follow the new book.'));
    return;
  }
  $('#book-title').textContent = snapshot?.title || 'Open a book in the workspace';
  document.title = (snapshot?.title ? snapshot.title + ' — ' : '') + 'Outline — Neo-AI';
  document.documentElement.classList.toggle('paper', snapshot?.theme === 'paper');
  $('#add-chapter').disabled = !snapshot;
  const structure = JSON.stringify([snapshot?.bookId, snapshot?.chapters.map((ch) => [ch.id, ch.sections.map((s) => s.id)])]);
  if (structure !== renderedStructure) {
    // Rebuild only for structural edits, never on every keystroke or word count.
    renderedStructure = structure;
    $('#outline').replaceChildren();
    if (!snapshot || !snapshot.chapters.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = snapshot ? 'Add a chapter to begin your outline.' : 'Open a book to see its chapters and sections here.';
      $('#outline').append(empty);
    }
    for (const ch of snapshot?.chapters || []) {
      const box = document.createElement('section');
      box.className = 'chapter'; box.dataset.chapter = ch.id;
      const head = document.createElement('div'); head.className = 'chapter-head';
      const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'chapter-title';
      jump.title = 'Show this chapter in the manuscript';
      jump.onclick = () => act({ type: 'navigate', chapterId: ch.id });
      const words = document.createElement('span'); words.className = 'words';
      head.append(jump, words); box.append(head, noteField(ch));
      const sections = document.createElement('div'); sections.className = 'sections';
      for (const section of ch.sections) sections.append(noteField(ch, section));
      box.append(sections);
      const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Section'; add.className = 'add-section';
      add.onclick = () => act({ type: 'addSection', chapterId: ch.id });
      box.append(add); $('#outline').append(box);
    }
  }
  for (const box of document.querySelectorAll('[data-chapter]')) {
    const ch = snapshot.chapters.find((c) => c.id === box.dataset.chapter);
    box.classList.toggle('current', ch.id === snapshot.currentChapterId);
    box.querySelector('.chapter-title').textContent = ch.title;
    box.querySelector('.words').textContent = ch.words.toLocaleString() + ' words';
  }
  for (const field of document.querySelectorAll('textarea[data-key]')) {
    if (drafts.has(field.dataset.key)) continue;
    const [chapterId, sectionId] = JSON.parse(field.dataset.key);
    const text = currentText({ chapterId, sectionId }) || '';
    if (field.value !== text) field.value = text;
  }
}
async function flush() {
  clearTimeout(timer);
  if (blocked) throw new Error('Resolve the unsaved outline edits first.');
  if (running) { await running; return flush(); }
  running = (async () => {
    while (drafts.size) {
      const [key, draft] = drafts.entries().next().value;
      const sent = { ...draft };
      await api.command(sent);
      // Typing can continue during IPC. Only remove the acknowledged version.
      if (draft.text === sent.text) drafts.delete(key);
      else draft.expected = sent.text;
    }
    $('#status').textContent = 'Saved · connected to the writing workspace';
  })();
  try { await running; } catch (error) { showError(error); throw error; }
  finally { running = null; }
}
async function act(command) {
  try {
    const bookId = snapshot?.bookId;
    await flush();
    await api.command({ ...command, bookId });
  } catch (error) { showError(error); }
}
async function close(dock) {
  if (closing) return;
  closing = true;
  try { await flush(); await api.close(dock); }
  catch (error) { showError(error); }
  finally { closing = false; }
}
$('#dock').onclick = () => close(true);
$('#add-chapter').onclick = () => act({ type: 'addChapter' });
$('#retry').onclick = async () => {
  if ([...drafts.values()].some((d) => d.bookId !== snapshot?.bookId || currentText(d) === undefined)) {
    showError(new Error('The original book or outline item is no longer open. Copy your draft before discarding it.')); return;
  }
  for (const draft of drafts.values()) draft.expected = currentText(draft);
  blocked = false; $('#error-box').hidden = true;
  try { await flush(); render(); } catch (error) { showError(error); }
};
$('#discard').onclick = () => {
  if (running) return;
  drafts.clear(); blocked = false; $('#error-box').hidden = true;
  renderedStructure = ''; render(); $('#status').textContent = 'Unsaved edits discarded';
};
api.onState((state) => { snapshot = state.snapshot; render(); });
api.onCloseRequested(() => close(false));
api.onFlushRequested(async (id) => {
  try { await flush(); api.flushed({ id }); }
  catch (error) { api.flushed({ id, error: error.message }); }
});
api.state().then((state) => { snapshot = state.snapshot; render(); }).catch(showError);
