(() => {
  const root = document.createElement('section'); root.id = 'ai-chat-workspace'; root.hidden = true;
  document.querySelector('#paper-scroll').prepend(root);
  const view = new NeoChatView(root, {
    settings: () => window.neo.openSettings(),
    detach: async () => {
      try { await view.flushEdits(); publishPaneState(); await window.neo.openPane('ai-assistance'); }
      catch (error) { view.error(error); }
    }
  });
  window.neoChatView = view;
  let navigationSignature = '';
  view.onNavigation = () => {
    const signature = JSON.stringify([view.bookId, view.root.hidden, view.current()?.id, view.navigation, view.state?.conversations.map(c => [c.id, c.title])]);
    if (navigationSignature === signature || book?.id !== view.bookId) return;
    navigationSignature = signature;
    if (!view.openingChatId && workspaceSelection && WorkspaceTree.find(book.workspaceTree[workspaceSelection.section], workspaceSelection.id)?.node.type === 'chat') {
      const node = workspaceChatNodes().find(item => item.node.conversationId === view.current()?.id);
      if (node) workspaceSelection = { bookId: book.id, section: node.section, id: node.node.id };
    }
    renderWorkspaceTrees();
    if (!view.root.hidden && view.current()) {
      const label = document.querySelector('#workspace-section-label');
      label.textContent = 'AI Assistance / ' + view.current().title; label.title = label.textContent;
      const row = [...document.querySelectorAll('.workspace-node')].find(item =>
        workspaceChatNodes().some(chat => chat.node.id === item.dataset.id && chat.node.conversationId === view.current().id));
      row?.scrollIntoView({ block: 'nearest' });
    }
  };
  window.neo.onPaneState(({ snapshot, detached }) => {
    view.contextPicker.invalidate(snapshot?.contextRevision);
    view.setDetached(detached.includes('ai-assistance'));
    if (view.bookId !== snapshot?.bookId) view.showBook(snapshot?.bookId || null, snapshot?.title, false).catch(error => view.error(error));
    view.setNavigation(snapshot?.chats);
  });
  window.addEventListener('focus', () => { if (view.bookId) view.refreshConnections(); });
  window.addEventListener('blur', () => view.flushEdits().catch(error => view.error(error)));
})();
