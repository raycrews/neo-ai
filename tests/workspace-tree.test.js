const { test } = require('node:test');
const assert = require('node:assert/strict');
const Tree = require('../workspace-tree-model');
test('creation uses the supplied parent, including the section root', () => {
  const nodes = [{ id: 'chapter', type: 'folder', children: [] }];
  Tree.insert(nodes, 'chapter', { id: 'scene', type: 'document' });
  Tree.insert(nodes, null, { id: 'next-chapter', type: 'folder', children: [] });
  assert.equal(Tree.find(nodes, 'scene').parentId, 'chapter');
  assert.equal(Tree.find(nodes, 'next-chapter').parentId, null);
  assert.throws(() => Tree.insert(nodes, 'scene', {id:'bad',type:'document'}), /no longer exists/);
  assert.deepEqual(nodes.map(n => n.id), ['chapter', 'next-chapter']);
});
test('folder edges reorder siblings and folder centers nest items', () => {
  const nodes = [{id:'one',type:'folder',children:[{id:'scene',type:'document'}]}, {id:'two',type:'folder',children:[]}];
  let target = Tree.destination(nodes, 'one', 'before');
  Tree.move(nodes, 'two', target.parentId, target.beforeId);
  assert.deepEqual(nodes.map(n => n.id), ['two','one']);
  target = Tree.destination(nodes, 'two', 'inside');
  Tree.move(nodes, 'scene', target.parentId, target.beforeId);
  assert.equal(Tree.find(nodes, 'scene').parentId, 'two');
  target = Tree.destination(nodes, 'one', 'after');
  Tree.move(nodes, 'two', target.parentId, target.beforeId);
  assert.deepEqual(nodes.map(n => n.id), ['one','two']);
  assert.throws(() => Tree.destination(nodes, 'scene', 'inside'), /cannot contain/);
});
test('legacy chapters keep their IDs and order when adopting folders', () => {
  const book = { chapterOrder: ['one', 'two'] };
  assert.deepEqual(Tree.documents(Tree.reconcile(book).manuscript), ['one', 'two']);
  assert.deepEqual(book.chapterOrder, ['one', 'two']);
});
test('nested moves preserve documents and reject folder cycles', () => {
  const nodes = [{ id: 'act', type: 'folder', children: [{ id: 'chapter', type: 'folder', children: [] }] }, { id: 'scene', type: 'document' }];
  Tree.move(nodes, 'scene', 'chapter');
  assert.deepEqual(Tree.documents(nodes), ['scene']);
  const before = JSON.stringify(nodes);
  assert.throws(() => Tree.move(nodes, 'act', 'chapter'), /inside itself/);
  assert.equal(JSON.stringify(nodes), before);
  assert.throws(() => Tree.move(nodes, 'scene', 'missing'), /no longer exists/);
  assert.equal(JSON.stringify(nodes), before);
});
test('core chapter insertion and deletion preserve folders and reference text', () => {
  const book = { chapterOrder: ['one', 'new'], workspaceTree: {
    manuscript: [{ id: 'act', type: 'folder', children: [{ id: 'one', type: 'document' }, { id: 'deleted', type: 'document' }] }],
    characters: [{ id: 'person', type: 'document', text: 'Keep this biography.' }]
  } };
  const tree = Tree.reconcile(book);
  assert.deepEqual(tree.manuscript[0].children.map(n => n.id), ['one', 'new']);
  assert.equal(tree.characters[0].text, 'Keep this biography.');
  assert.deepEqual(Tree.reconcile(JSON.parse(JSON.stringify(book))), tree);
});

test('whole subtrees move through every section without losing IDs, contents, or targets', () => {
  const book = { chapterOrder: ['scene'] };
  const tree = Tree.reconcile(book);
  const subtree = { id: 'folder', type: 'folder', title: 'Chapter', children: [
    { id: 'scene', type: 'document', html: '<p><em>Keep this.</em></p>', wordGoal: 2500 }
  ] };
  tree.manuscript = [subtree];
  let previous = 'manuscript';
  for (const section of [...Tree.sections.slice(1), 'manuscript']) {
    Tree.transfer(tree, previous, section, 'folder', null, null);
    book.chapterOrder = Tree.documents(tree.manuscript);
    Tree.reconcile(book);
    assert.equal(Tree.find(tree[previous], 'folder'), null);
    assert.equal(Tree.find(tree[section], 'folder').node, subtree);
    assert.equal(Tree.find(tree[section], 'scene').node.wordGoal, 2500);
    previous = section;
  }
  assert.deepEqual(book.chapterOrder, ['scene']);
});

test('invalid section transfers leave both sections unchanged', () => {
  const tree = Tree.reconcile({ chapterOrder: ['scene'] });
  tree.characters.push({ id: 'person', type: 'document', text: 'Biography' });
  const before = JSON.stringify(tree);
  assert.throws(() => Tree.transfer(tree, 'manuscript', 'characters', 'scene', 'person'), /no longer exists/);
  assert.throws(() => Tree.transfer(tree, 'manuscript', 'characters', 'scene', null, 'missing'), /destination changed/);
  assert.throws(() => Tree.transfer(tree, 'manuscript', 'unknown', 'scene'), /Invalid section/);
  assert.equal(JSON.stringify(tree), before);
});

test('AI context excludes disabled subtrees and always excludes Darlings', () => {
  const tree = Tree.reconcile({ chapterOrder: [] });
  tree.characters = [{id:'folder',type:'folder',children:[
    {id:'included',type:'document'}, {id:'excluded',type:'document',aiContext:false}
  ]}];
  tree.darlings = [{id:'darling',type:'document',aiContext:true}];
  assert.deepEqual(Tree.contextDocuments(tree), [{section:'characters',id:'included'}]);
  tree.characters[0].aiContext = false;
  tree.characters[0].children.push({id:'new',type:'document',aiContext:true});
  assert.equal(Tree.contextState(tree,'characters','included').blockedBy, 'folder');
  assert.deepEqual(Tree.contextDocuments(tree), []);
  tree.characters[0].aiContext = true;
  assert.deepEqual(Tree.contextDocuments(tree).map(item=>item.id), ['included','new']);
  assert.equal(Tree.contextState(tree,'characters','excluded').enabled, false);
  assert.equal(Tree.contextState(tree,'darlings','darling').enabled, false);
});

test('AI context flags survive moves, serialization and reconciliation', () => {
  const book = {chapterOrder:[]};
  const tree = Tree.reconcile(book);
  tree.notes = [{id:'folder',type:'folder',aiContext:false,children:[{id:'doc',type:'document'}]}];
  Tree.transfer(tree,'notes','research','folder',null,null);
  const reopened = Tree.reconcile(JSON.parse(JSON.stringify(book)));
  assert.equal(Tree.contextState(reopened,'research','doc').enabled,false);
  Tree.transfer(reopened,'research','notes','doc',null,null);
  assert.equal(Tree.contextState(reopened,'notes','doc').enabled,true);
  reopened.notes[0].aiContext = false;
  Tree.transfer(reopened,'notes','darlings','doc',null,null);
  Tree.transfer(reopened,'darlings','manuscript','doc',null,null);
  assert.equal(Tree.contextState(reopened,'manuscript','doc').enabled,false);
});
