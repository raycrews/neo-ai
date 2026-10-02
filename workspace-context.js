// Read from the editor's live state, including typing that has not autosaved yet.
function contextPlainText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  holder.querySelectorAll('script,style,template,.darling-anchor,.ph-mark,.ghost').forEach(node => node.remove());
  holder.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  holder.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,tr').forEach(node => node.append('\n'));
  return holder.textContent.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function liveChatContext(bookId) {
  if (!book || book.id !== bookId) throw new Error('The open book changed. Reopen the context picker.');
  if (treeMoveBusy) throw new Error('Wait for the document move to finish before using context.');
  return ChatContext.catalog(book, id => {
    const body = [...document.querySelectorAll('.chapter')].find(node => node.dataset.id === id)?.querySelector('.chapter-body');
    return body ? body.innerHTML : chapterHTML[id] || '';
  }, contextPlainText);
}
