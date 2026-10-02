// Export records preserve sidebar order; the live book is never rearranged.
(function (root) {
  function catalog(book) {
    const rows = [];
    for (const section of ['manuscript', 'outline', 'characters', 'locations', 'worldbuilding', 'research', 'notes', 'darlings', 'ai-assistance']) {
      const nodes = book.workspaceTree?.[section] || [];
      function walk(items, parents = []) {
        for (const node of items) {
          if (node.type === 'folder') walk(node.children || [], [...parents, node]);
          else if (node.type === 'document') {
            const title = section === 'manuscript' ? book.chapterTitles?.[node.id] || 'Untitled document' : node.title || 'Untitled document';
            rows.push({ id: node.id, section, title, path: [...parents.map(p => p.title), title].join(' / '),
              group: section === 'manuscript' && parents.length ? parents[0].id : node.id,
              groupTitle: section === 'manuscript' && parents.length ? parents[0].title : title });
          }
        }
      }
      walk(nodes);
    }
    return rows;
  }
  function roman(number) {
    let result = '';
    for (const [value, symbol] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
      while (number >= value) { result += symbol; number -= value; }
    }
    return result;
  }
  function numberedHeading(title, number, style) {
    if (!['arabic', 'roman'].includes(style)) return title;
    // Replace an existing Chapter 2 / Chapter II prefix, preserving its subtitle.
    // Ordinary titles (including words made of Roman-numeral letters) stay intact.
    const match = title.match(/^Chapter\s+(\d+|[IVXLCDM]+)(?=$|[\s.:–—-])[\s.:–—-]*(.*)$/i);
    const validRoman = value => /^(?=.)M*(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(value);
    const subtitle = match && (/^\d+$/.test(match[1]) || validRoman(match[1])) ? match[2].trim() : /^Chapter$/i.test(title) ? '' : title;
    return `Chapter ${style === 'roman' ? roman(number) : number}${subtitle ? ' — ' + subtitle : ''}`;
  }
  function sections(rows, selected, mode, breaks, read, numbering = 'named') {
    const result = [];
    let chapterNumber = 0;
    for (const row of rows.filter(r => selected.has(r.id))) {
      const key = mode === 'documents' ? row.id : row.group;
      let group = result.at(-1);
      if (!group || group.key !== key || group.section !== row.section) {
        let title = mode === 'documents' ? row.title : row.groupTitle;
        if (row.section === 'manuscript') {
          chapterNumber++;
          if (mode !== 'none') title = numberedHeading(title, chapterNumber, numbering);
        }
        group = { key, section: row.section, num: result.length + 1, heading: mode === 'none' ? '' : title, navigationTitle: title, paras: [], documents: [] };
        result.push(group);
      }
      const paras = read(row);
      if (breaks && group.paras.length && paras.length && !group.paras.at(-1).sceneBreak && !paras[0].sceneBreak) group.paras.push({ sceneBreak: true, text: '***', runs: [] });
      group.paras.push(...paras); group.documents.push(row.title);
    }
    return result;
  }
  const api = { catalog, sections };
  if (typeof module === 'object') module.exports = api;
  else root.ManuscriptExport = api;
})(typeof window === 'object' ? window : globalThis);
