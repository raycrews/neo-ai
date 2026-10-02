// Targets follow document IDs when items are renamed or moved.
function activeProgressDocument() {
  if (!book) return null;
  const section = workspaceSelection?.section || currentTab;
  const id = workspaceSelection?.id || (section === 'manuscript' ? currentChapterId : null);
  const node = WorkspaceTree.sections.includes(section) &&
    WorkspaceTree.find(WorkspaceTree.reconcile(book)[section], id)?.node;
  if (!node || node.type !== 'document') return null;
  const content = document.createElement('div');
  if (typeof node.html === 'string') {
    content.innerHTML = node.html;
    content.querySelectorAll('p, div, br, li, h1, h2, h3, blockquote').forEach(element => element.append(' '));
  }
  return { section, node, words: section === 'manuscript' ? chapterWords(id) : countWords(typeof node.html === 'string' ? content.textContent : node.text || '') };
}

function paintWordProgress(id, words, goal, name, enabled = true) {
  const button = document.getElementById(id);
  const bar = button.querySelector('progress');
  const target = Number.isFinite(goal) && goal > 0 ? goal : 0;
  button.disabled = !enabled;
  button.classList.toggle('goal-met', target > 0 && words >= target);
  button.querySelector('.word-progress-count').textContent = !enabled ? '—' :
    target ? `${fmtNum(words)} / ${fmtNum(target)}` : `${fmtNum(words)} words`;
  bar.max = target || 1;
  bar.value = target ? Math.min(words, target) : 0;
  bar.setAttribute('aria-valuetext', !enabled ? 'Select a document' :
    target ? `${words} of ${target} words` : `${words} words; no target set`);
  button.title = !enabled ? 'Select a document to see its word count and goal' :
    `${name}: ${fmtNum(words)} words${target ? ` — ${Math.round(words / target * 100)}% of goal` : ' — no target set'}. Click to set a word target.`;
  button.setAttribute('aria-label', button.title);
}

function updateWorkspaceProgress() {
  if (!book) return;
  const document = activeProgressDocument();
  paintWordProgress('document-progress', document?.words || 0, document?.node.wordGoal,
    document ? treeNodeTitle(document.section, document.node) : 'Document', !!document);
  paintWordProgress('manuscript-progress', bookWordCount(), book.wordGoal, 'Manuscript');
}

async function editWordTarget(kind) {
  const owner = book;
  if (!owner) return;
  const document = kind === 'document' ? activeProgressDocument() : null;
  if (kind === 'document' && !document) return;
  const target = document ? document.node : owner;
  const name = document ? treeNodeTitle(document.section, target) : 'Manuscript';
  const value = await askInput(escHtml(name) + ' — word target', 'Target words — leave blank to remove', String(target.wordGoal || ''));
  if (value === null || book !== owner) return;
  const goal = Number(value.trim());
  if (!Number.isSafeInteger(goal) || goal < 0) { toast('Enter a whole number of words, or leave the target blank.'); return; }
  // A document may have been removed or replaced while the dialog was open.
  if (document && WorkspaceTree.find(book.workspaceTree[document.section], target.id)?.node !== target) return;
  target.wordGoal = goal;
  await saveMeta();
  updateCounters();
}

document.getElementById('document-progress').onclick = () => editWordTarget('document');
document.getElementById('manuscript-progress').onclick = () => editWordTarget('manuscript');
