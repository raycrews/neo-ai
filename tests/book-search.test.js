const { test } = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../book-search');

test('search includes nested documents, excluded context and original compacted chat messages', () => {
  const book = { chapterOrder: ['scene'], chapterTitles: { scene: 'Opening' }, workspaceTree: {
    manuscript: [{ id: 'scene', type: 'document' }],
    characters: [{ id: 'folder', title: 'Cast', type: 'folder', aiContext: false, children: [{ id: 'person', title: 'Elara', type: 'document', text: 'Moonlight in her eyes.' }] }],
    darlings: [{ id: 'cut', title: 'Removed scene', type: 'document', text: 'Moonlight on the lake.' }],
    notes: [{ id: 'linked', type: 'chat', conversationId: 'chat', title: 'Moved chat' }]
  } };
  const conversations = [{ id: 'chat', title: 'Moved chat', navigationLinked: true, summary: { throughId: 'old' }, messages: [{ id: 'old', role: 'assistant', content: 'Moonlight remembered.' }] },
    { id: 'legacy', title: 'Legacy', messages: [{ id: 'user', role: 'user', content: 'Moonlight question.' }] },
    { id: 'removed', title: 'Deleted', navigationLinked: true, messages: [{ id: 'other', role: 'user', content: 'Moonlight removed.' }] }];
  const rows = Search.catalog(book, () => 'Moonlight through the window.', s => s, conversations, s => s);
  const found = Search.search(rows, 'MOONLIGHT');
  assert.equal(found.total, 5);
  assert.equal(found.results.find(r => r.id === 'person').path, 'Characters / Cast / Elara');
  assert.equal(found.results.find(r => r.messageId === 'old').section, 'notes');
  assert.equal(Search.search(rows, 'Moonlight', 'characters').total, 1);
  assert.equal(Search.search(rows, 'Cast').total, 1);
  assert.equal(Search.search(rows, 'Moved chat').total, 1);
});

test('queries are literal, whitespace normalized, blank queries empty, snippets bounded and results capped', () => {
  const rows = Array.from({ length: 205 }, (_, id) => ({ id, kind: 'document', path: 'Notes / ' + id, text: 'x'.repeat(400) + ' [a.*] A\nphrase ' + 'y'.repeat(400) }));
  assert.equal(Search.search(rows, '  ').total, 0);
  assert.equal(Search.search(rows, '[a.*]').total, 205);
  assert.equal(Search.search(rows, 'A phrase').total, 205);
  const found = Search.search(rows, '[a.*]');
  assert.equal(found.results.length, 200); assert.ok(found.results[0].preview.includes('[a.*]'));
  assert.ok(found.results[0].preview.length < 220);
  assert.equal(Search.search(rows, '[unmatched').total, 0);
});
