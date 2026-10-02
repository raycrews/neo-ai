/* Shared by the desktop renderer and storage tests. IDs never depend on names. */
(function (root) {
  const sections = ['manuscript', 'outline', 'characters', 'locations', 'worldbuilding', 'research', 'notes', 'darlings', 'ai-assistance'];
  function find(nodes, id, parentId = null) {
    for (const node of nodes) {
      if (node.id === id) return { node, siblings: nodes, parentId };
      const nested = node.type === 'folder' && find(node.children, id, node.id);
      if (nested) return nested;
    }
    return null;
  }
  function documents(nodes) {
    return nodes.flatMap(node => node.type === 'folder' ? documents(node.children) : node.type === 'chat' ? [] : [node.id]);
  }
  function reconcile(book) {
    book.workspaceTree ||= { version: 1 };
    for (const section of sections) book.workspaceTree[section] ||= [];
    const nodes = book.workspaceTree.manuscript;
    const allowed = new Set(book.chapterOrder);
    const seen = new Set();
    function prune(list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const node = list[i];
        if (node.type === 'folder') prune(node.children);
        else if (node.type === 'chat') continue;
        else if (!allowed.has(node.id) || seen.has(node.id)) list.splice(i, 1);
        else seen.add(node.id);
      }
    }
    prune(nodes);
    book.chapterOrder.forEach((id, index) => {
      if (seen.has(id)) return;
      const previous = index && find(nodes, book.chapterOrder[index - 1]);
      const list = previous ? previous.siblings : nodes;
      const position = previous ? list.indexOf(previous.node) + 1 : 0;
      list.splice(position, 0, { id, type: 'document' });
      seen.add(id);
    });
    return book.workspaceTree;
  }
  function children(nodes, parentId) {
    if (!parentId) return nodes;
    const parent = find(nodes, parentId)?.node;
    if (!parent || parent.type !== 'folder') throw new Error('This folder no longer exists.');
    return parent.children;
  }
  function insert(nodes, parentId, node) {
    if (find(nodes, node.id)) throw new Error('This item already exists.');
    children(nodes, parentId).push(node);
  }
  function destination(nodes, targetId, position) {
    if (!targetId) return { parentId: null, beforeId: null };
    const target = find(nodes, targetId);
    if (!target) throw new Error('The destination no longer exists.');
    if (position === 'inside') {
      if (target.node.type !== 'folder') throw new Error('Documents cannot contain other items.');
      return { parentId: targetId, beforeId: null };
    }
    if (!['before', 'after'].includes(position)) throw new Error('Invalid drop position.');
    return { parentId: target.parentId, beforeId: position === 'before' ? targetId :
      target.siblings[target.siblings.indexOf(target.node) + 1]?.id || null };
  }
  function move(nodes, id, parentId, beforeId) {
    const source = find(nodes, id);
    if (!source) throw new Error('This item no longer exists.');
    if (id === parentId || (source.node.type === 'folder' && find(source.node.children, parentId))) {
      throw new Error('A folder cannot be moved inside itself.');
    }
    const target = children(nodes, parentId);
    if (beforeId === id) return;
    if (beforeId && !target.some(n => n.id === beforeId)) throw new Error('The destination changed.');
    source.siblings.splice(source.siblings.indexOf(source.node), 1);
    target.splice(beforeId ? target.findIndex(n => n.id === beforeId) : target.length, 0, source.node);
  }
  function transfer(tree, fromSection, toSection, id, parentId, beforeId) {
    if (!sections.includes(fromSection) || !sections.includes(toSection)) throw new Error('Invalid section.');
    if (fromSection === toSection) return move(tree[fromSection], id, parentId, beforeId);
    const source = find(tree[fromSection], id);
    if (!source) throw new Error('This item no longer exists.');
    const target = children(tree[toSection], parentId);
    if (beforeId && !target.some(node => node.id === beforeId)) throw new Error('The destination changed.');
    const ids = [];
    const collect = node => { ids.push(node.id); if (node.type === 'folder') node.children.forEach(collect); };
    collect(source.node);
    if (ids.some(itemId => find(tree[toSection], itemId))) throw new Error('The destination already contains this item.');
    source.siblings.splice(source.siblings.indexOf(source.node), 1);
    target.splice(beforeId ? target.findIndex(node => node.id === beforeId) : target.length, 0, source.node);
  }
  function contextState(tree, section, id) {
    const nodes = tree?.[section] || [];
    const found = find(nodes, id);
    if (!found) return { enabled: false, own: false, blockedBy: null };
    const own = found.node.aiContext !== false;
    if (section === 'darlings') return { enabled: false, own, blockedBy: 'darlings' };
    let parentId = found.parentId;
    while (parentId) {
      const parent = find(nodes, parentId);
      if (parent.node.aiContext === false) return { enabled: false, own, blockedBy: parentId };
      parentId = parent.parentId;
    }
    return { enabled: own, own, blockedBy: null };
  }
  // One shared eligibility rule for AI features; this returns IDs, never sends data.
  function contextDocuments(tree) {
    const result = [];
    for (const section of sections) {
      if (section === 'darlings') continue;
      const visit = nodes => {
        for (const node of nodes) {
          if (node.aiContext === false) continue;
          if (node.type === 'folder') visit(node.children);
          else result.push({ section, id: node.id });
        }
      };
      visit(tree?.[section] || []);
    }
    return result;
  }
  const api = { sections, find, documents, reconcile, children, insert, destination, move, transfer, contextState, contextDocuments };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WorkspaceTree = api;
})(typeof window !== 'undefined' ? window : globalThis);
