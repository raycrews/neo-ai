const view = new NeoChatView(document.querySelector('#ai-chat-pane'), {
  dock: () => closeChat(true)
});
let closingChat = false;
async function closeChat(dock) {
  if (closingChat) return;
  closingChat = true;
  try { await view.flush(); await window.neoPane.close(dock); }
  catch (error) { view.error(error); closingChat = false; }
}
async function stateChanged({ snapshot }) {
  view.contextPicker.invalidate(snapshot?.contextRevision);
  view.setNavigation(snapshot?.chats);
  document.title = (snapshot?.title || '') + ' — AI Assistance — Neo-AI';
  await view.showBook(snapshot?.bookId || null, snapshot?.title);
}
window.neoPane.onState(state => stateChanged(state).catch(error => view.error(error)));
window.neoPane.state().then(stateChanged).catch(error => view.error(error));
window.neoPane.onCloseRequested(() => closeChat(false));
window.neoPane.onFlushRequested(async request => {
  const id = typeof request === 'object' ? request.id : request;
  try { if (request?.draftsOnly) await view.flushEdits(); else await view.flush(); window.neoPane.flushed({ id }); }
  catch (error) { view.error(error); window.neoPane.flushed({ id, error: error.message }); }
});
window.addEventListener('blur', () => view.flushEdits().catch(error => view.error(error)));
window.addEventListener('focus', () => view.refreshConnections());
