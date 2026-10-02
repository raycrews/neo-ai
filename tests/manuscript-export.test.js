const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog, sections } = require('../manuscript-export');
test('export follows folder order, excludes chats, and groups only selected scenes', () => {
  const book = { chapterTitles: { b: 'Scene B', a: 'Scene A', c: 'Ending' }, workspaceTree: {
    notes: [{ id: 'note', type: 'document', title: 'Research' }],
    manuscript: [{ id: 'chapter', type: 'folder', title: 'Arrival', children: [{ id: 'b', type: 'document' }, { id: 'nested', type: 'folder', title: 'Part', children: [{ id: 'a', type: 'document' }] }] }, { id: 'c', type: 'document' }, { id: 'chat', type: 'chat' }]
  }};
  const before = JSON.stringify(book), rows = catalog(book);
  assert.deepEqual(rows.map(r => r.id), ['b', 'a', 'c', 'note']);
  const read = row => [{ text: row.title }];
  const selected = new Set(['a', 'b', 'note']);
  const grouped = sections(rows, selected, 'folders', true, read);
  assert.deepEqual(grouped.map(g => g.heading), ['Arrival', 'Research']);
  assert.deepEqual(grouped[0].paras.map(p => p.text), ['Scene B', '***', 'Scene A']);
  assert.equal(sections(rows, selected, 'documents', true, read).length, 3);
  assert.ok(sections(rows, selected, 'none', false, read).every(g => !g.heading));
  assert.deepEqual(sections(rows, new Set(), 'folders', true, read), []);
  assert.equal(JSON.stringify(book), before);
});

test('chapter numbering normalizes existing prefixes, preserves titles and leaves reference documents alone', () => {
  const titles = ['Chapter 1', 'Chapter II', 'Chapter 03: Arrival', 'Chapter IV — Departure', '1984', 'Chapter Civil War'];
  const rows = titles.map((title, i) => ({ id: String(i), section: 'manuscript', title, group: String(i), groupTitle: title }));
  rows.push({ id: 'note', section: 'notes', title: 'Chapter II notes', group: 'note', groupTitle: 'Chapter II notes' });
  const before = JSON.stringify(rows), selected = new Set(rows.map(r => r.id));
  const build = (style, mode = 'folders', selection = selected) => sections(rows, selection, mode, true, () => [], style);
  assert.deepEqual(build('named').map(g => g.heading), [...titles, 'Chapter II notes']);
  assert.deepEqual(build('roman').map(g => g.heading), ['Chapter I', 'Chapter II', 'Chapter III — Arrival', 'Chapter IV — Departure', 'Chapter V — 1984', 'Chapter VI — Chapter Civil War', 'Chapter II notes']);
  assert.deepEqual(build('arabic', 'documents').map(g => g.heading), ['Chapter 1', 'Chapter 2', 'Chapter 3 — Arrival', 'Chapter 4 — Departure', 'Chapter 5 — 1984', 'Chapter 6 — Chapter Civil War', 'Chapter II notes']);
  assert.deepEqual(build('roman', 'folders', new Set(['2', '3'])).map(g => g.heading), ['Chapter I — Arrival', 'Chapter II — Departure']);
  assert.ok(build('roman', 'none').every(g => !g.heading));
  assert.deepEqual(build('roman', 'none').map(g => g.navigationTitle), [...titles, 'Chapter II notes']);
  assert.equal(JSON.stringify(rows), before);
});

test('Roman chapter numbering handles subtractive notation and large chapter counts', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), section: 'manuscript', title: 'Chapter', group: String(i), groupTitle: 'Chapter' }));
  const output = sections(rows, new Set(rows.map(r => r.id)), 'folders', false, () => [], 'roman');
  for (const [n, expected] of [[4,'IV'],[9,'IX'],[40,'XL'],[49,'XLIX'],[90,'XC'],[99,'XCIX'],[400,'CD'],[900,'CM'],[999,'CMXCIX'],[1000,'M']]) assert.equal(output[n-1].heading, 'Chapter '+expected);
});
