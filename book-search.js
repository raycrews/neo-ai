// Shared search logic: literal, case-insensitive matching of readable book text.
(function (root) {
  const labels = { manuscript: 'Manuscript', outline: 'Outline', characters: 'Characters', locations: 'Locations', worldbuilding: 'Worldbuilding', research: 'Research', notes: 'Notes', darlings: 'Darlings', 'ai-assistance': 'AI Assistance' };
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  function matcher(query) {
    query = clean(query);
    return query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
  }
  function snippet(text, expression) {
    text = clean(text);
    const hit = expression.exec(text);
    const start = Math.max(0, (hit?.index || 0) - 65);
    const end = Math.min(text.length, Math.max(start + 200, (hit?.index || 0) + (hit?.[0].length || 0) + 45));
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }
  function catalog(book, manuscript, plainText, conversations, markdownText) {
    const rows = [], linked = new Set();
    const chats = new Map(conversations.map(c => [c.id, c]));
    function chat(c, row) {
      linked.add(c.id);
      rows.push({ ...row, title: c.title, conversationId: c.id, kind: 'chat', text: '' });
      for (const m of c.messages) rows.push({ ...row, title: c.title, conversationId: c.id, messageId: m.id, kind: 'message',
        speaker: m.role === 'user' ? 'You' : 'Assistant', text: m.role === 'assistant' ? markdownText(m.content) : m.content });
    }
    for (const section of Object.keys(labels)) {
      function visit(nodes, parents = []) {
        for (const node of nodes) {
          const title = section === 'manuscript' && node.type === 'document' ? book.chapterTitles?.[node.id] || 'Chapter ' + (book.chapterOrder.indexOf(node.id) + 1) : node.title || 'Untitled';
          if (node.type === 'folder') { visit(node.children || [], [...parents, title]); continue; }
          const row = { id: node.id, section, title, path: [labels[section], ...parents, title].join(' / ') };
          if (node.type === 'chat') { const c = chats.get(node.conversationId); if (c) chat(c, row); }
          else rows.push({ ...row, kind: 'document', text: section === 'manuscript' ? plainText(manuscript(node.id)) : typeof node.html === 'string' ? plainText(node.html) : node.text || '' });
        }
      }
      visit(book.workspaceTree?.[section] || []);
    }
    // Older chats may not have navigation entries until first opened.
    for (const c of conversations) if (!linked.has(c.id) && !c.navigationLinked)
      chat(c, { section: 'ai-assistance', path: 'AI Assistance / ' + c.title });
    return rows;
  }
  function search(rows, query, section = '', limit = 200) {
    const expression = matcher(query);
    if (!expression) return { results: [], total: 0 };
    const results = []; let total = 0;
    for (const row of rows) {
      if (section && row.section !== section) continue;
      // A matching chat title gets one result, rather than repeating every turn.
      const match = expression.test(clean(row.text)) || (row.kind !== 'message' && expression.test(clean(row.path)));
      if (!match) continue;
      total++;
      if (results.length < limit) results.push({ ...row, preview: snippet(row.text, expression) });
    }
    return { results, total };
  }
  const api = { labels, matcher, catalog, search };
  if (typeof module !== 'undefined') module.exports = api; else root.BookSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
