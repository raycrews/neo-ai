// Folder organization is stored in book.json; manuscript text stays in its
// existing chapter files. Reference documents have their own stable IDs.
let workspaceSelection = null;
let treeDragging = false;
let treeMoveBusy = false;
let treeMenu = null;
let treePointer = null;
let suppressTreeClickUntil = 0;
const treeEditor = document.createElement('section');
treeEditor.id = 'workspace-tree-editor';
treeEditor.hidden = true;
document.querySelector('#paper-scroll').prepend(treeEditor);
const sectionLabels = { manuscript: 'Manuscript', outline: 'Outline', characters: 'Characters', locations: 'Locations', worldbuilding: 'Worldbuilding', research: 'Research', notes: 'Notes', darlings: 'Darlings', 'ai-assistance': 'AI Assistance' };
const folderIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h6l2 2h8v10H2z"/></svg>';
const documentIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2h7l4 4v12H5zM12 2v5h4"/></svg>';
function treeButton(label, text, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className;
  button.title = label; button.setAttribute('aria-label', label);
  button.textContent = text; button.onclick = action;
  return button;
}
function treeIsCollapsed(key) { return !!navigationPreferences.treeCollapsed?.[key]; }
function treeSetCollapsed(key, collapsed) {
  navigationPreferences.treeCollapsed ||= {};
  navigationPreferences.treeCollapsed[key] = collapsed;
  saveNavigationPreferences();
}
function treeNodeTitle(section, node) {
  return section === 'manuscript' && node.type === 'document'
    ? book.chapterTitles?.[node.id] || t('Chapter {n}', { n: book.chapterOrder.indexOf(node.id) + 1 })
    : node.title;
}
function selectWorkspaceRoot() { workspaceSelection = null; }
function updateWorkspaceBreadcrumb() {
  if (!book || currentTab !== 'manuscript') return;
  const path = [];
  let id = workspaceSelection?.section === 'manuscript' ? workspaceSelection.id : currentChapterId;
  while (id) {
    const found = WorkspaceTree.find(WorkspaceTree.reconcile(book).manuscript, id);
    if (!found) break;
    path.unshift(treeNodeTitle('manuscript', found.node));
    id = found.parentId;
  }
  const label = document.querySelector('#workspace-section-label');
  label.textContent = ['Manuscript', ...path].join(' / ');
  label.title = label.textContent;
}
function openWorkspaceNode(section, id) {
  const node = WorkspaceTree.find(WorkspaceTree.reconcile(book)[section], id)?.node;
  if (!node) return;
  workspaceSelection = { bookId: book.id, section, id };
  if (section === 'manuscript' && node.type === 'document') {
    workspaceSelection = null;
    switchTab('manuscript'); focusChapter(id);
  } else switchTab(section, true);
  document.querySelectorAll('.workspace-node').forEach(item => {
    item.classList.toggle('current', item.dataset.id === workspaceSelection?.id ||
      (section === 'manuscript' && item.dataset.id === currentChapterId));
  });
}
async function addWorkspaceItem(section, parentId, type, suggestedName) {
  const bookId = book?.id;
  if (!bookId) return;
  const parentName = parentId ? WorkspaceTree.find(WorkspaceTree.reconcile(book)[section], parentId)?.node.title : sectionLabels[section];
  if (!parentName) return;
  const title = await askInput((type === 'folder' ? 'New folder in ' : 'New document in ') + escHtml(parentName), 'Name', suggestedName || (type === 'folder' ? 'New folder' : 'Untitled document'));
  if (!title?.trim() || book?.id !== bookId) return;
  try {
    if (section === 'ai-assistance' && type === 'document') {
      const view = window.neoChatView;
      if (view.detached) await window.neo.flushChatDrafts();
      await view.showBook(bookId, book.title, false);
      const state = await view.run({ type: 'new', title: title.trim(), parentId });
      if (state && book?.id === bookId) {
        const match = workspaceChatNodes().find(item => item.node.conversationId === state.selectedId);
        if (match) openWorkspaceNode(match.section, match.node.id);
      }
      return;
    }
    await flushAllSaves();
    if (book?.id !== bookId) return;
    const nodes = WorkspaceTree.reconcile(book)[section];
    WorkspaceTree.children(nodes, parentId); // Validate the explicit menu destination.
    if (section === 'manuscript') snapshotStructure('add ' + type);
    const id = (type === 'folder' ? 'folder-' : section === 'manuscript' ? 'ch-' : 'doc-') + crypto.randomUUID();
    const node = type === 'folder' ? { id, type, title: title.trim(), children: [] } : { id, type, title: title.trim(), text: '' };
    if (section === 'manuscript' && type === 'document') {
      book.chapterTitles ||= {};
      book.chapterTitles[id] = title.trim();
      chapterHTML[id] = '<p><br></p>';
      await persistChapter(id);
      delete node.title; delete node.text;
    }
    WorkspaceTree.insert(nodes, parentId, node);
    if (section === 'manuscript') book.chapterOrder = WorkspaceTree.documents(nodes);
    treeSetCollapsed(section, false);
    if (parentId) treeSetCollapsed(book.id + ':' + parentId, false);
    await saveMeta();
    if (section === 'manuscript') renderChapters();
    renderWorkspaceTrees();
    openWorkspaceNode(section, id);
  } catch (error) { toast(error.message, 7000); }
}
function closeTreeMenu() {
  if (!treeMenu) return;
  treeMenu.trigger.setAttribute('aria-expanded', 'false');
  treeMenu.element.remove(); treeMenu = null;
}
async function saveChatToNotes(bookId, node) {
  if (!book || book.id !== bookId) throw new Error('The open book changed. Export the chat from its own book.');
  if (treeMoveBusy) throw new Error('Finish the current navigation change before exporting the chat.');
  if (!node || node.type !== 'document' || typeof node.id !== 'string' || typeof node.title !== 'string' || typeof node.text !== 'string') throw new Error('Invalid chat export.');
  treeMoveBusy = true;
  let notes, added = false;
  try {
    await flushAllSaves();
    notes = WorkspaceTree.reconcile(book).notes;
    const existing = notes.find(item => item.id === node.id);
    if (existing) return { id: existing.id, title: existing.title, section: 'notes' };
    const baseTitle = node.title;
    let suffix = 2;
    while (notes.some(item => item.title === node.title)) node.title = baseTitle + ' (' + suffix++ + ')';
    notes.push(node); added = true;
    clearTimeout(saveTimers.meta);
    await saveMeta();
    treeSetCollapsed('notes', false);
    renderWorkspaceTrees();
    // Refresh a folder browser while preserving an open document and its caret.
    if (currentTab === 'notes' && (!workspaceSelection || WorkspaceTree.find(notes, workspaceSelection.id)?.node.type === 'folder')) showWorkspaceTreeSection('notes');
    return { id: node.id, title: node.title, section: 'notes' };
  } catch (error) {
    if (added) notes.splice(notes.findIndex(item => item.id === node.id), 1);
    renderWorkspaceTrees();
    throw new Error('Could not save the chat to Notes. Check library access and try again.');
  } finally { treeMoveBusy = false; }
}
async function renameWorkspaceItem(section, id) {
  const bookId = book?.id;
  const node = book && WorkspaceTree.find(WorkspaceTree.reconcile(book)[section], id)?.node;
  if (!node) return;
  const name = await askInput('Edit name', 'Name', treeNodeTitle(section, node));
  if (!name?.trim() || book?.id !== bookId) return;
  const current = WorkspaceTree.find(book.workspaceTree[section], id)?.node;
  if (!current) return;
  try {
    if (current.type === 'chat') {
      const result = await window.neoChat.action(bookId, { type: 'rename', id: current.conversationId, text: name.trim() });
      if (result.error) throw new Error(result.error);
      return;
    }
    if (section === 'manuscript' && current.type === 'document') {
      book.chapterTitles ||= {};
      book.chapterTitles[id] = name.trim();
      const heading = document.querySelector(`.chapter[data-id="${id}"] .ch-title`);
      if (heading) { heading.textContent = name.trim(); heading.closest('.chapter-head').classList.add('has-title'); }
    } else current.title = name.trim();
    await saveMeta();
    renderWorkspaceTrees();
    if (workspaceSelection?.id === id) showWorkspaceTreeSection(section);
  } catch (error) { toast(error.message, 7000); }
}
async function deleteWorkspaceItem(section, id) {
  const bookId = book?.id;
  let found = book && WorkspaceTree.find(WorkspaceTree.reconcile(book)[section], id);
  if (!found) return;
  const title = treeNodeTitle(section, found.node);
  const choice = await optionModal('Delete “' + escHtml(title) + '”?',
    found.node.type === 'folder' ? 'This deletes the folder and everything inside it.' : 'This deletes the document.',
    [{ label: 'Delete', value: 'delete', danger: true,
      desc: section === 'manuscript' && found.node.type !== 'chat' ? 'Manuscript text will be kept in Darlings. You can also undo this action.' : 'You can undo this action while this book stays open.' }]);
  if (choice !== 'delete' || book?.id !== bookId) return;
  try {
    if (window.neo.flushPanes) await window.neo.flushPanes();
    await flushAllSaves();
    if (book?.id !== bookId) return;
    found = WorkspaceTree.find(book.workspaceTree[section], id);
    if (!found) return;
    if (section === 'manuscript' && found.node.type !== 'chat') {
      snapshotStructure('delete ' + found.node.type);
      const ids = WorkspaceTree.documents([found.node]);
      const deleted = new Set(ids);
      const savedDarlings = [...darlings];
      for (const chapterId of ids) {
        const text = chapterText(chapterId).trim();
        if (text) savedDarlings.push({ id: 'd-' + crypto.randomUUID(), html: chapterHTML[chapterId] || '',
          text: text.slice(0, 2000), chapterId: null,
          chapterLabel: 'deleted ' + treeNodeTitle(section, {id: chapterId, type: 'document'}), date: new Date().toISOString() });
      }
      await window.neo.writeJSON(bookId, 'darlings', savedDarlings);
      darlings = savedDarlings;
      found.siblings.splice(found.siblings.indexOf(found.node), 1);
      book.chapterOrder = book.chapterOrder.filter(chapterId => !deleted.has(chapterId));
      for (const chapterId of ids) {
        clearTimeout(saveTimers[chapterId]); delete saveTimers[chapterId];
        delete chapterHTML[chapterId]; delete savedHTML[chapterId]; delete wordCache[chapterId];
        delete book.chapterTitles?.[chapterId]; delete book.chapterNotes?.[chapterId]; delete book.sectionNotes?.[chapterId];
      }
      stickies = stickies.filter(note => !deleted.has(note.chapterId));
      await saveMeta();
      await window.neo.writeJSON(bookId, 'stickies', stickies);
      for (const chapterId of ids) await window.neo.deleteChapter(bookId, chapterId);
      if (deleted.has(currentChapterId)) currentChapterId = null;
      renderChapters(); renderStickies(); updateCounters();
    } else {
      snapshotStructure('delete ' + found.node.type, { referenceSection: section,
        removedNode: found.node, parentId: found.parentId, index: found.siblings.indexOf(found.node) });
      found.siblings.splice(found.siblings.indexOf(found.node), 1);
      await saveMeta();
    }
    if (workspaceSelection?.section === section && !WorkspaceTree.find(book.workspaceTree[section], workspaceSelection.id)) workspaceSelection = null;
    renderWorkspaceTrees();
    switchTab(currentTab, true);
    document.querySelector(`.workspace-root[data-section="${section}"] .tab`).focus();
    toast('Deleted. ' + KZ + ' to undo.');
  } catch (error) { toast(error.message, 7000); }
}
async function toggleWorkspaceAIContext(section, id) {
  if (!book || treeMoveBusy) return;
  const tree = WorkspaceTree.reconcile(book);
  const node = WorkspaceTree.find(tree[section], id)?.node;
  const state = WorkspaceTree.contextState(tree, section, id);
  if (!node || state.blockedBy) return;
  const previous = node.aiContext;
  node.aiContext = !state.own;
  try { await saveMeta(); } catch (error) {
    if (previous === undefined) delete node.aiContext; else node.aiContext = previous;
    toast('Could not save the AI context setting: ' + error.message, 7000);
  }
}
function openTreeMenu(trigger, section, id = null) {
  const wasOpen = treeMenu?.trigger === trigger;
  closeTreeMenu();
  if (wasOpen) return;
  const menu = document.createElement('div');
  menu.className = 'workspace-add-menu'; menu.setAttribute('role', 'menu');
  const node = id ? WorkspaceTree.find(book.workspaceTree[section], id)?.node : null;
  if (id && !node) return;
  const options = [];
  if (!node || node.type === 'folder') options.push(
    ['New folder', () => addWorkspaceItem(section, id, 'folder')],
    ['New document', () => addWorkspaceItem(section, id, 'document')]);
  if (node) options.push(['Edit', () => renameWorkspaceItem(section, id)],
    ['Use as AI context', () => toggleWorkspaceAIContext(section, id)],
    ['Delete', () => deleteWorkspaceItem(section, id)]);
  for (const [label, action] of options) {
    const button = treeButton(label, label, () => { closeTreeMenu(); action(); });
    if (label === 'Delete') button.classList.add('tree-delete-action');
    button.setAttribute('role', 'menuitem'); menu.append(button);
    if (label === 'Use as AI context') {
      const state = WorkspaceTree.contextState(book.workspaceTree, section, id);
      button.classList.add('tree-context-toggle');
      button.setAttribute('role', 'menuitemcheckbox');
      button.setAttribute('aria-checked', String(state.enabled));
      button.disabled = !!state.blockedBy;
      const explanation = state.blockedBy === 'darlings' ? 'Darlings are always excluded from AI context.' :
        state.blockedBy ? 'Excluded by folder “' + WorkspaceTree.find(book.workspaceTree[section], state.blockedBy).node.title + '”. Enable that folder first.' :
        node.type === 'folder' ? 'Applies to everything inside this folder. Individual exclusions are preserved.' : 'Allow this document to be used as AI context.';
      button.title = explanation;
      if (state.blockedBy) {
        const note = document.createElement('div'); note.className = 'tree-context-reason'; note.textContent = explanation;
        note.id = 'tree-context-reason'; button.setAttribute('aria-describedby', note.id); menu.append(note);
      }
    }
  }
  document.body.append(menu);
  const rect = trigger.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  trigger.setAttribute('aria-expanded', 'true');
  treeMenu = { element: menu, trigger };
  menu.firstElementChild.focus();
  menu.onkeydown = (event) => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') { closeTreeMenu(); trigger.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
    }
  };
}
document.addEventListener('pointerdown', event => {
  if (treeMenu && !treeMenu.element.contains(event.target) && !treeMenu.trigger.contains(event.target)) closeTreeMenu();
});
window.addEventListener('blur', closeTreeMenu);
document.querySelector('#nav-pane').addEventListener('scroll', closeTreeMenu);

function renderWorkspaceTrees() {
  if (!book || treeDragging) return;
  const tree = WorkspaceTree.reconcile(book);
  for (const section of WorkspaceTree.sections) {
    const root = document.querySelector(`.workspace-root[data-section="${section}"]`);
    const list = document.querySelector(`.workspace-tree[data-section="${section}"]`);
    const collapsed = treeIsCollapsed(section);
    list.hidden = collapsed;
    const toggle = root.querySelector('.tree-toggle');
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + sectionLabels[section]);
    toggle.onclick = () => { treeSetCollapsed(section, !treeIsCollapsed(section)); renderWorkspaceTrees(); };
    const menu = root.querySelector('.tree-menu');
    menu.setAttribute('aria-haspopup', 'menu');
    menu.onclick = () => openTreeMenu(menu, section);
    list.replaceChildren();
    function appendNodes(nodes, container, parentId) {
      for (const node of nodes) {
        const item = document.createElement('div');
        item.className = 'workspace-node nav-item'; item.dataset.id = node.id;
        if (node.id === workspaceSelection?.id || (section === 'manuscript' && node.id === currentChapterId) ||
          (node.type === 'chat' && !window.neoChatView?.root.hidden && node.conversationId === window.neoChatView?.current()?.id)) item.classList.add('current');
        const row = document.createElement('div'); row.className = 'tree-row';
        row.dataset.treeId = node.id; row.dataset.section = section;
        if (node.type === 'folder') {
          const key = book.id + ':' + node.id;
          const toggle = treeButton('Toggle ' + node.title, treeIsCollapsed(key) ? '▸' : '▾', () => {
            treeSetCollapsed(key, !treeIsCollapsed(key)); renderWorkspaceTrees();
          }, 'tree-toggle');
          toggle.setAttribute('aria-expanded', String(!treeIsCollapsed(key))); row.append(toggle);
        }
        const title = treeNodeTitle(section, node);
        const link = treeButton(title + ' — drag to move', '', () => {
          if (Date.now() >= suppressTreeClickUntil) openWorkspaceNode(section, node.id);
        }, 'n-row tree-node-link');
        row.addEventListener('pointerdown', event => {
          if (treeMoveBusy) return;
          if (event.target.closest('.tree-toggle, .tree-menu')) return;
          clearTimeout(saveTimers.nav);
          if (event.button === 0) treePointer = { pointerId: event.pointerId, source: row, bookId: book.id,
            section, id: node.id, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
        });
        link.addEventListener('dblclick', event => { event.preventDefault(); renameWorkspaceItem(section, node.id); });
        link.innerHTML = node.type === 'folder' ? folderIcon : documentIcon;
        const label = document.createElement('span'); label.className = 'n-label'; label.textContent = title;
        link.append(label);
        // Preserve keyboard activation in synthetic events as well as native clicks.
        link.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); link.click(); }
        };
        // Pointer capture keeps dragging consistent across native Electron windows.
        link.draggable = false;
        row.append(link);
        const grip = document.createElement('span');
        grip.className = 'tree-drag-grip'; grip.textContent = '⠿';
        grip.title = 'Drag to move. Drop on a folder to nest, or between items to reorder.';
        grip.setAttribute('aria-hidden', 'true');
        row.append(grip);
        const itemMenu = treeButton('Options for ' + title, '⋯', () => openTreeMenu(itemMenu, section, node.id), 'tree-menu');
        itemMenu.setAttribute('aria-haspopup', 'menu');
        row.append(itemMenu);
        wireTreeDrop(row, section);
        item.append(row); container.append(item);
        if (node.type === 'folder') {
          const children = document.createElement('div'); children.className = 'tree-children';
          children.hidden = treeIsCollapsed(book.id + ':' + node.id);
          item.append(children); appendNodes(node.children, children, node.id);
        }
      }
    }
    appendNodes(tree[section], list, null);
  }
}
async function moveWorkspaceItem(section, id, parentId, beforeId, targetSection = section, recordUndo = true) {
  if (!book || treeMoveBusy) throw new Error('Finish the current move first.');
  const owner = book;
  treeMoveBusy = true;
  try {
    if (window.neo.flushPanes) await window.neo.flushPanes();
    await flushAllSaves();
    if (book !== owner) throw new Error('The open book changed.');
    const tree = WorkspaceTree.reconcile(book);
    const source = WorkspaceTree.find(tree[section], id);
    if (!source) throw new Error('This item no longer exists.');
    const originalParent = source.parentId;
    const originalNext = source.siblings[source.siblings.indexOf(source.node) + 1]?.id || null;
    // Validate the full move before writing content or changing the live tree.
    WorkspaceTree.transfer(structuredClone(tree), section, targetSection, id, parentId, beforeId);
    const ids = WorkspaceTree.documents([source.node]);
    const documents = ids.map(docId => WorkspaceTree.find([source.node], docId).node);
    const backups = documents.map(node => ({ node, copy: structuredClone(node),
      html: chapterHTML[node.id], title: book.chapterTitles?.[node.id] }));
    const entersManuscript = section !== 'manuscript' && targetSection === 'manuscript';
    if (entersManuscript) {
      for (const node of documents) {
        const html = typeof node.html === 'string' ? node.html :
          (node.text || '').split('\n').map(line => '<p>' + (escHtml(line) || '<br>') + '</p>').join('');
        // Content must exist before the catalog can start referencing it.
        await window.neo.writeChapter(owner.id, node.id, html);
      }
    }
    if (book !== owner) throw new Error('The open book changed.');
    if (section === 'manuscript' && targetSection !== 'manuscript') {
      for (const node of documents) {
        node.title = treeNodeTitle('manuscript', node);
        node.html = chapterHTML[node.id] || '';
      }
    }
    if (entersManuscript) {
      book.chapterTitles ||= {};
      for (const node of documents) {
        chapterHTML[node.id] = typeof node.html === 'string' ? node.html :
          (node.text || '').split('\n').map(line => '<p>' + (escHtml(line) || '<br>') + '</p>').join('');
        savedHTML[node.id] = chapterHTML[node.id];
        book.chapterTitles[node.id] = node.title || 'Untitled document';
      }
    }
    WorkspaceTree.transfer(tree, section, targetSection, id, parentId, beforeId);
    book.chapterOrder = WorkspaceTree.documents(tree.manuscript);
    try { await saveMeta(); } catch (error) {
      WorkspaceTree.transfer(tree, targetSection, section, id, originalParent, originalNext);
      book.chapterOrder = WorkspaceTree.documents(tree.manuscript);
      for (const { node, copy, html, title } of backups) {
        for (const key of Object.keys(node)) delete node[key];
        Object.assign(node, copy);
        if (entersManuscript) {
          if (html === undefined) { delete chapterHTML[node.id]; delete savedHTML[node.id]; }
          else { chapterHTML[node.id] = html; savedHTML[node.id] = html; }
          if (title === undefined) delete book.chapterTitles[node.id]; else book.chapterTitles[node.id] = title;
        }
      }
      throw error;
    }
    if (recordUndo) {
      undoStack.push({ label: 'move item', treeMove: { section: targetSection, targetSection: section,
        id, parentId: originalParent, beforeId: originalNext } });
      if (undoStack.length > 10) undoStack.shift();
    }
    treeSetCollapsed(targetSection, false);
    if (parentId) treeSetCollapsed(book.id + ':' + parentId, false);
    if (!book.chapterOrder.includes(currentChapterId)) currentChapterId = null;
    if (section === 'manuscript' || targetSection === 'manuscript') renderChapters();
    renderWorkspaceTrees();
    openWorkspaceNode(targetSection, id);
    updateCounters();
  } finally { treeMoveBusy = false; }
}
function treeDropDestination(element, section, clientY, source = null) {
  const nodes = WorkspaceTree.reconcile(book)[section];
  const targetId = element.dataset.treeId || null;
  const target = targetId && WorkspaceTree.find(nodes, targetId)?.node;
  const rect = element.getBoundingClientRect();
  const ratio = rect.height ? (clientY - rect.top) / rect.height : 0;
  const position = !target ? 'inside' : target.type === 'folder'
    ? (ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside')
    : ratio < 0.5 ? 'before' : 'after';
  const destination = WorkspaceTree.destination(nodes, targetId, position);
  if (source) {
    if (source.bookId !== book.id) throw new Error('The open book changed.');
    const node = WorkspaceTree.find(book.workspaceTree[source.section], source.id)?.node;
    if (!node) throw new Error('This item no longer exists.');
    if (node.id === destination.parentId || (node.type === 'folder' && WorkspaceTree.find(node.children, destination.parentId))) throw new Error('A folder cannot be moved inside itself.');
  }
  return { ...destination, section, position, element,
    label: `Move ${position} ${target ? treeNodeTitle(section, target) : sectionLabels[section]}` };
}
function clearTreeDropIndicators() {
  document.querySelectorAll('[data-tree-drop]').forEach(element => delete element.dataset.treeDrop);
}
function wireTreeDrop(element, section) {
  element.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('application/x-neo-tree')) return;
    event.preventDefault(); event.stopPropagation(); clearTreeDropIndicators();
    element.dataset.treeDrop = treeDropDestination(element, section, event.clientY).position;
    event.dataTransfer.dropEffect = 'move';
  });
  element.addEventListener('dragleave', () => { delete element.dataset.treeDrop; });
  element.addEventListener('drop', async event => {
    const raw = event.dataTransfer.getData('application/x-neo-tree');
    if (!raw) return;
    event.preventDefault(); event.stopPropagation(); clearTreeDropIndicators(); treeDragging = false;
    try {
      const source = JSON.parse(raw);
      const destination = treeDropDestination(element, section, event.clientY, source);
      await moveWorkspaceItem(source.section, source.id, destination.parentId, destination.beforeId, section);
    } catch (error) { toast(error.message, 7000); }
  });
}
const treeDragHint = document.createElement('div');
treeDragHint.id = 'tree-drag-hint'; treeDragHint.hidden = true;
document.body.append(treeDragHint);
function updateTreePointerTarget() {
  if (!treeDragging || !treePointer) return;
  clearTreeDropIndicators(); treePointer.destination = null;
  const hit = document.elementFromPoint(treePointer.x, treePointer.y);
  const element = hit?.closest('.tree-row, .workspace-root, .workspace-tree');
  try {
    if (!element) throw new Error('Drop on a folder or between items');
    const destination = treeDropDestination(element, element.dataset.section, treePointer.y, treePointer);
    destination.element.dataset.treeDrop = destination.position;
    treePointer.destination = destination;
    treeDragHint.textContent = destination.label;
  } catch (error) { treeDragHint.textContent = error.message; }
  treeDragHint.hidden = false;
}
function scrollTreeWhileDragging() {
  if (!treeDragging || !treePointer) return;
  const pane = document.querySelector('#nav-pane');
  const rect = pane.getBoundingClientRect();
  if (treePointer.x >= rect.left && treePointer.x <= rect.right) {
    const amount = treePointer.y < rect.top + 45 ? -9 : treePointer.y > rect.bottom - 45 ? 9 : 0;
    if (amount) { pane.scrollTop += amount; updateTreePointerTarget(); }
  }
  requestAnimationFrame(scrollTreeWhileDragging);
}
function endTreePointer() {
  const state = treePointer;
  treePointer = null; treeDragging = false;
  if (state?.source.hasPointerCapture(state.pointerId)) state.source.releasePointerCapture(state.pointerId);
  document.body.classList.remove('tree-dragging');
  state?.source.classList.remove('tree-drag-source');
  clearTreeDropIndicators(); treeDragHint.hidden = true;
  return state;
}
document.addEventListener('pointermove', event => {
  if (!treePointer || treePointer.pointerId !== event.pointerId) return;
  treePointer.x = event.clientX; treePointer.y = event.clientY;
  if (!treeDragging && Math.hypot(event.clientX - treePointer.startX, event.clientY - treePointer.startY) >= 6) {
    treeDragging = true; closeTreeMenu();
    treePointer.source.setPointerCapture(event.pointerId);
    document.body.classList.add('tree-dragging');
    treePointer.source.classList.add('tree-drag-source');
    requestAnimationFrame(scrollTreeWhileDragging);
  }
  if (treeDragging) { event.preventDefault(); updateTreePointerTarget(); }
});
document.addEventListener('pointerup', async event => {
  if (!treePointer || treePointer.pointerId !== event.pointerId) return;
  const dragged = treeDragging;
  const state = endTreePointer();
  if (!dragged) return;
  suppressTreeClickUntil = Date.now() + 300;
  event.preventDefault();
  try {
    if (state.bookId === book?.id && state.destination) {
      const destination = state.destination;
      await moveWorkspaceItem(state.section, state.id, destination.parentId, destination.beforeId, destination.section);
    }
  } catch (error) { toast(error.message, 7000); }
});
document.addEventListener('pointercancel', endTreePointer);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && treePointer) { suppressTreeClickUntil = Date.now() + 300; endTreePointer(); }
});
window.addEventListener('blur', endTreePointer);
for (const section of WorkspaceTree.sections) {
  wireTreeDrop(document.querySelector(`.workspace-root[data-section="${section}"]`), section, null, null);
  wireTreeDrop(document.querySelector(`.workspace-tree[data-section="${section}"]`), section, null, null);
}
function showWorkspaceTreeSection(section) {
  treeEditor.hidden = true;
  if (!book || !WorkspaceTree.sections.includes(section)) return false;
  const nodes = WorkspaceTree.reconcile(book)[section];
  const selection = workspaceSelection?.bookId === book.id && workspaceSelection.section === section
    ? WorkspaceTree.find(nodes, workspaceSelection.id)?.node : null;
  if (section === 'manuscript' && !selection) return false;
  treeEditor.replaceChildren(); treeEditor.hidden = false;
  document.querySelector('#workspace-section').hidden = true;
  const caption = document.createElement('p'); caption.className = 'workspace-section-eyebrow';
  caption.textContent = sectionLabels[section] + (selection ? ' / ' + (selection.type === 'folder' ? 'Folder' : 'Document') : '');
  treeEditor.append(caption);
  if (selection) {
    const title = document.createElement('input'); title.className = 'tree-editor-title'; title.value = selection.title;
    title.setAttribute('aria-label', 'Name');
    title.addEventListener('input', () => {
      selection.title = title.value; scheduleMetaSave(); scheduleNavRefresh();
    });
    title.addEventListener('blur', () => {
      if (!selection.title.trim()) { selection.title = selection.type === 'folder' ? 'Untitled folder' : 'Untitled document'; title.value = selection.title; scheduleMetaSave(); }
      scheduleNavRefresh();
    });
    treeEditor.append(title);
  } else {
    const title = document.createElement('h1'); title.textContent = sectionLabels[section]; treeEditor.append(title);
  }
  if (selection?.type === 'document') {
    const text = document.createElement('div'); text.className = 'tree-document-text';
    text.setAttribute('aria-label', 'Document text');
    text.contentEditable = 'true'; text.setAttribute('role', 'textbox'); text.setAttribute('aria-multiline', 'true');
    text.dataset.placeholder = 'Start writing…';
    text.innerHTML = typeof selection.html === 'string' ? DocumentRichText.clean(selection.html) : DocumentRichText.fromText(selection.text);
    text.addEventListener('paste', event => {
      event.preventDefault();
      const html = event.clipboardData.getData('text/html');
      if (html) document.execCommand('insertHTML', false, DocumentRichText.clean(html));
      else document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    text.addEventListener('input', () => {
      selection.html = DocumentRichText.serialize(text);
      selection.text = DocumentRichText.plainText(selection.html);
      scheduleMetaSave(); updateWorkspaceProgress();
    });
    treeEditor.append(text);
  } else {
    const toolbar = document.createElement('div'); toolbar.className = 'tree-editor-actions';
    toolbar.append(treeButton('New folder', '+ Folder', () => addWorkspaceItem(section, selection?.id, 'folder')),
      treeButton('New document', '+ Document', () => addWorkspaceItem(section, selection?.id, 'document')));
    treeEditor.append(toolbar);
    const children = selection ? selection.children : nodes;
    const list = document.createElement('div'); list.className = 'tree-folder-contents';
    for (const node of children) {
      const button = treeButton(treeNodeTitle(section, node), '', () => openWorkspaceNode(section, node.id));
      button.innerHTML = node.type === 'folder' ? folderIcon : documentIcon;
      const label = document.createElement('span'); label.textContent = treeNodeTitle(section, node); button.append(label); list.append(button);
    }
    if (!children.length) {
      const empty = document.createElement('p'); empty.textContent = 'Add a folder to organize your work, or a document to start writing.'; list.append(empty);
    }
    treeEditor.append(list);
  }
  // The section heading keeps its existing tools below the folder browser.
  return !!selection || !['outline', 'notes', 'darlings', 'ai-assistance'].includes(section);
}
