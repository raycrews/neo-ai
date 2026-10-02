const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ChatStore } = require('./ai-chat-store');
const { exportConversation } = require('./chat-export');
const { randomUUID } = require('node:crypto');

function installChat({ ipcMain, paneWindows, connections, assistants, bookDir }) {
  const urls = new Set(['index.html', 'ai-pane.html'].map(file => pathToFileURL(path.join(__dirname, file)).href));
  async function context(bookId) {
    const rows = await paneWindows.readChatContext(bookId);
    if (paneWindows.getSnapshot()?.bookId !== bookId) throw new Error('The open book changed. Reopen the context picker.');
    const chats = store.read(bookId).conversations;
    return rows.map(row => row.conversationId && row.enabled ? { ...row, text: chats.find(c => c.id === row.conversationId)?.messages.length ? exportConversation(chats.find(c => c.id === row.conversationId)).text : '' } : row);
  }
  const store = new ChatStore({ connections, resolveContext: context,
    instructionsFor: id => assistants.instructions(id),
    syncNavigation: (bookId, conversations) => paneWindows.syncChatNavigation({ type: 'syncChats', bookId, conversations }), fileFor: id => {
    const dir = bookDir(id);
    if (!fs.existsSync(path.join(dir, 'book.json'))) throw new Error('Open an existing book first.');
    return path.join(dir, 'ai-chats.json');
  }, changed: (bookId, state) => paneWindows.send('chat:state', { bookId, state }) });
  function trusted(event) {
    return (paneWindows.isOwner(event) || paneWindows.kindFor(event) === 'ai-assistance') &&
      event.senderFrame === event.sender.mainFrame && urls.has(event.senderFrame.url);
  }
  function handle(name, fn) {
    ipcMain.handle(name, async (event, bookId, ...args) => {
      if (!trusted(event) || paneWindows.getSnapshot()?.bookId !== bookId) return { error: 'Chat request denied. Open this book in the writing workspace.' };
      try { return { value: await fn(bookId, ...args) }; }
      catch (error) { return { error: error.code ? 'Could not save chat. Check disk space and file permissions.' : error.message }; }
    });
  }
  handle('chat:read', id => store.action(id, { type: 'syncNavigation' }));
  handle('chat:context', context);
  handle('chat:budget', (bookId, id, draft, preview) => store.inspect(bookId, id, draft, preview));
  handle('chat:limit', (_bookId, profileId, model, limit) => {
    const result = connections.setContextLimit(profileId, model, limit);
    paneWindows.send('chat:contextChanged'); return result;
  });
  handle('chat:action', (id, action) => store.action(id, action));
  handle('chat:connections', () => connections.snapshot());
  handle('chat:models', async (_id, profileId) => {
    const result = await connections.request(profileId, 'models');
    paneWindows.send('chat:contextChanged'); return result;
  });
  handle('chat:export', async (bookId, conversationId) => {
    const state = store.state(bookId);
    if (state.job) throw new Error('Stop or finish the reply before exporting this chat.');
    const conversation = state.conversations.find(c => c.id === conversationId);
    if (!conversation) throw new Error('That conversation no longer exists.');
    const transcript = exportConversation(conversation);
    // The workspace owns book.json and merges the new Note with live edits.
    // The main chat service never overwrites a book's navigation metadata.
    return paneWindows.commandOwner({ type: 'exportChat', bookId,
      node: { id: 'doc-' + randomUUID(), type: 'document', ...transcript } });
  });
  handle('chat:flush', id => store.cache.has(store.key(id)) ? store.flush(id) : true);
  return store;
}
module.exports = { installChat };
