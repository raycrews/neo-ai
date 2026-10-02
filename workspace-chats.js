// Chat nodes point to ai-chats.json; they never become manuscript prose.
function workspaceChatNodes() {
  const result = [];
  if (!book) return result;
  const tree = WorkspaceTree.reconcile(book);
  const visit = (nodes, section) => {
    for (const node of nodes) {
      if (node.type === 'chat') result.push({ node, section });
      else if (node.type === 'folder') visit(node.children, section);
    }
  };
  for (const section of WorkspaceTree.sections) visit(tree[section], section);
  return result;
}
async function syncWorkspaceChats(bookId, conversations) {
  if (!book || book.id !== bookId) throw new Error('The open book changed. Reopen AI Assistance.');
  if (treeMoveBusy) throw new Error('Finish the navigation change before updating the chat list.');
  const existing = workspaceChatNodes();
  const needsWrite = conversations.some(c => {
    const match = existing.find(item => item.node.conversationId === c.id);
    return match ? match.node.title !== c.title : !c.linked;
  });
  if (!needsWrite) return existing.map(item => item.node.conversationId);
  treeMoveBusy = true;
  let before;
  try {
    await flushAllSaves();
    if (!book || book.id !== bookId) throw new Error('The open book changed.');
    before = structuredClone(book.workspaceTree);
    for (const c of conversations) {
      const match = workspaceChatNodes().find(item => item.node.conversationId === c.id);
      if (match) match.node.title = c.title;
      else if (!c.linked) {
        const nodes = book.workspaceTree['ai-assistance'];
        // A folder may have been removed while creation was pending. Keep the
        // saved conversation reachable at the section root in that case.
        const parent = c.parentId && WorkspaceTree.find(nodes, c.parentId)?.node;
        const children = parent?.type === 'folder' ? parent.children : nodes;
        children.push({ id: 'chat-' + c.id, type: 'chat', conversationId: c.id, title: c.title });
        treeSetCollapsed('ai-assistance', false);
        if (parent) treeSetCollapsed(book.id + ':' + parent.id, false);
      }
    }
    clearTimeout(saveTimers.meta);
    await saveMeta();
  } catch (error) {
    if (before) book.workspaceTree = before;
    throw new Error('The chat is saved, but its navigation entry could not be updated. Check library access and reopen AI Assistance to retry.');
  } finally { treeMoveBusy = false; renderWorkspaceTrees(); publishPaneState(); }
  return workspaceChatNodes().map(item => item.node.conversationId);
}
async function openWorkspaceChat(section, node) {
  const bookId = book.id;
  try {
    const view = window.neoChatView;
    view.openingChatId = node.id;
    if (view.detached) await window.neo.flushChatDrafts();
    await view.showBook(bookId, book.title, false);
    if (book?.id !== bookId || workspaceSelection?.id !== node.id) return;
    await view.run({ type: 'select', id: node.conversationId });
    if (view.detached) await window.neo.openPane('ai-assistance');
  } catch (error) { toast(error.message, 7000); }
  finally { if (window.neoChatView.openingChatId === node.id) window.neoChatView.openingChatId = null; renderWorkspaceTrees(); }
}
