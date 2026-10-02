// Shared clipboard/document formatting. Parse in an inert template and rebuild
// a small allowlist so pasted content cannot carry scripts or resources.
(() => {
  const allowed = new Set('p div br h1 h2 h3 h4 h5 h6 strong b em i u s strike del ul ol li blockquote pre code hr table thead tbody tfoot tr th td sup sub'.split(' '));
  const dropped = new Set('script style template iframe object embed img svg math link meta head title input button form textarea select audio video source'.split(' '));
  function clean(html) {
    const source = document.createElement('template'); source.innerHTML = html || '';
    const output = document.createElement('div');
    function copy(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.localName;
      if (dropped.has(tag)) return;
      let target = parent;
      if (allowed.has(tag)) {
        target = document.createElement(tag); parent.append(target);
        if (tag === 'ol' && /^\d{1,6}$/.test(node.getAttribute('start') || '')) target.setAttribute('start', node.getAttribute('start'));
        const alignment = node.style.textAlign || node.getAttribute('align');
        if (/^(left|center|right|justify)$/.test(alignment || '')) target.style.textAlign = alignment;
      }
      // Word and browser selections can encode emphasis only in styles.
      const weight = node.style.fontWeight;
      if (!['strong', 'b'].includes(tag) && (weight === 'bold' || Number(weight) >= 600)) { const bold = document.createElement('strong'); target.append(bold); target = bold; }
      if (!['em', 'i'].includes(tag) && node.style.fontStyle === 'italic') { const italic = document.createElement('em'); target.append(italic); target = italic; }
      for (const child of node.childNodes) copy(child, target);
    }
    for (const child of source.content.childNodes) copy(child, output);
    return output.innerHTML;
  }
  function fromText(text) {
    if (!text) return '';
    const output = document.createElement('div');
    for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      const p = document.createElement('p'); p.textContent = line; if (!line) p.append(document.createElement('br')); output.append(p);
    }
    return output.innerHTML;
  }
  function serialize(editor) {
    const copy = editor.cloneNode(true);
    // Chromium can place a list inside a styled paragraph. HTML parsers close
    // that paragraph on reload, losing the inherited alignment. Normalize only
    // the saved clone so the live selection and native undo history stay intact.
    for (const paragraph of copy.querySelectorAll('p')) {
      if (!paragraph.querySelector('ul,ol,div,p,h1,h2,h3,h4,h5,h6,blockquote,pre,table')) continue;
      const block = document.createElement('div');
      for (const attribute of paragraph.attributes) block.setAttribute(attribute.name, attribute.value);
      block.append(...paragraph.childNodes); paragraph.replaceWith(block);
    }
    return copy.innerHTML;
  }
  // Semantic plain text for text-only destinations: preserve list markers and
  // paragraph breaks instead of copying the Markdown punctuation.
  function plainText(html) {
    const holder = document.createElement('div'); holder.innerHTML = clean(html);
    function text(node, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      const tag = node.localName;
      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n\n';
      if (tag === 'ol' || tag === 'ul') {
        let number = Number(node.getAttribute('start')) || 1;
        return '\n' + [...node.children].filter(n => n.localName === 'li').map(li => {
          const marker = tag === 'ol' ? number++ + '. ' : '• ';
          const body = [...li.childNodes].map(child => text(child, depth + 1)).join('').trim();
          return '  '.repeat(depth) + marker + body;
        }).join('\n') + '\n';
      }
      const body = [...node.childNodes].map(child => text(child, depth)).join('');
      if (tag === 'td' || tag === 'th') return body + '\t';
      return /^(p|div|h[1-6]|blockquote|pre|tr)$/.test(tag) ? body + '\n\n' : body;
    }
    return text(holder).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // The manuscript exporters consume paragraphs. Keep the words and list
  // numbering from newly supported blocks when preparing that representation.
  function prepareExport(holder) {
    function listParagraphs(list, depth = 0) {
      const fragment = document.createDocumentFragment();
      let number = Number(list.getAttribute('start')) || 1;
      for (const li of [...list.children].filter(node => node.localName === 'li')) {
        let p = document.createElement('p'); p.append('  '.repeat(depth) + (list.localName === 'ol' ? number++ + '. ' : '• '));
        function flush() { if (p.childNodes.length) fragment.append(p); p = document.createElement('p'); }
        for (const child of [...li.childNodes]) {
          if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) continue;
          if (['ul', 'ol'].includes(child.localName)) { flush(); fragment.append(listParagraphs(child, depth + 1)); }
          else if (['p', 'div'].includes(child.localName)) { p.append(...child.childNodes); flush(); }
          else p.append(child);
        }
        flush();
      }
      return fragment;
    }
    for (const list of [...holder.querySelectorAll('ul, ol')]) {
      if (holder.contains(list) && !list.parentElement.closest('ul, ol')) list.replaceWith(listParagraphs(list));
    }
    for (const block of [...holder.querySelectorAll('h1,h2,h3,h4,h5,h6,pre,blockquote')]) {
      if (block.querySelector('p')) continue;
      const p = document.createElement('p');
      if (/^h[1-6]$/.test(block.localName)) { const strong = document.createElement('strong'); strong.append(...block.childNodes); p.append(strong); }
      else p.append(...block.childNodes);
      block.replaceWith(p);
    }
    for (const row of [...holder.querySelectorAll('tr')]) {
      const p = document.createElement('p');
      for (const [index, cell] of [...row.children].entries()) { if (index) p.append(' | '); p.append(...cell.childNodes); }
      row.replaceWith(p);
    }
  }
  window.DocumentRichText = { clean, fromText, serialize, plainText, prepareExport };
})();
