// A shared text representation for HTML, PDF, Word, EPUB, Markdown and TXT.
window.ExportText = (() => {
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function runs(html) {
    const holder = document.createElement('div'); holder.innerHTML = DocumentRichText.clean(html);
    const result = [];
    function walk(node, flags = {}) {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) result.push({ text: node.textContent.replace(/\u00a0/g, ' '), ...flags }); return; }
      const tag = node.localName;
      if (tag === 'br') { result.push({ text: '\n', ...flags }); return; }
      const next = { b: flags.b || /^(b|strong)$/.test(tag), i: flags.i || /^(i|em)$/.test(tag), u: flags.u || tag === 'u', s: flags.s || /^(s|strike|del)$/.test(tag) };
      for (const child of node.childNodes) walk(child, next);
    }
    walk(holder); return result;
  }
  function inline(items) {
    return items.map(r => {
      let text = escape(r.text).replace(/\n/g, '<br/>');
      if (r.i) text = `<em>${text}</em>`;
      if (r.b) text = `<strong>${text}</strong>`;
      if (r.u) text = `<u>${text}</u>`;
      if (r.s) text = `<s>${text}</s>`;
      return text;
    }).join('');
  }
  function html(p) {
    const styles = [p.align ? `text-align:${p.align}` : '', p.preserveSpacing ? 'white-space:pre-wrap;tab-size:4' : ''].filter(Boolean);
    const style = styles.length ? ` style="${styles.join(';')}"` : '';
    const body = inline(p.runs);
    if (p.list) {
      const tag = p.list.ordered ? 'ol' : 'ul';
      return `<${tag}${p.list.ordered ? ` start="${p.list.number}"` : ''} style="margin-left:${p.list.depth * 1.5}em"><li${style}>${body}</li></${tag}>`;
    }
    const tag = p.heading ? 'h' + p.heading : 'p';
    return `<${tag}${p.poetry ? ' class="poetry"' : p.heading ? ' class="text-heading"' : ''}${style}>${body}</${tag}>`;
  }
  function paragraphs(source) {
    const holder = document.createElement('div'); holder.innerHTML = source || '';
    const ghostIds = new Set([...holder.querySelectorAll('.ghost[data-sec-id]')].map(n => n.dataset.secId));
    holder.querySelectorAll('[data-sec-brk]').forEach(n => { if (ghostIds.has(n.dataset.secBrk)) n.remove(); });
    holder.querySelectorAll('.darling-anchor,.ph-mark,.ghost,script,style,template,iframe,object,svg,math').forEach(n => n.remove());
    const result = [];
    function emit(nodes, options) {
      const fragment = document.createElement('div'); nodes.forEach(n => fragment.append(n.cloneNode(true)));
      const items = runs(fragment.innerHTML);
      const rawText = items.map(r => r.text).join('');
      // Pasted verse can be an ordinary paragraph with indented hard lines.
      // Preserve that spacing without reclassifying the author's paragraph.
      const preserveSpacing = !!fragment.querySelector('br') && /\n[ \t]+\S/.test(rawText);
      const text = options.poetry || preserveSpacing ? rawText.replace(/^\n|\n$/g, '') : rawText.trim();
      if (!text.trim() && !options.sceneBreak) return;
      const p = { ...options, preserveSpacing, runs: items, text };
      p.html = html(p); result.push(p);
    }
    function visit(node, options = {}) {
      const tag = node.localName;
      const alignment = node.style?.textAlign || node.getAttribute?.('align');
      options = { ...options, ...(/^(left|center|right|justify)$/.test(alignment) ? { align: alignment } : {}) };
      if (node.classList?.contains('scene-break') || tag === 'hr') { emit([], { sceneBreak: true }); return; }
      if (tag === 'ul' || tag === 'ol') {
        let number = Math.max(1, Math.min(999999, Number(node.getAttribute('start')) || 1));
        for (const li of node.children) if (li.localName === 'li') visit(li, { ...options, list: { ordered: tag === 'ol', number: number++, depth: options.list ? options.list.depth + 1 : 0 } });
        return;
      }
      if (/^h[1-6]$/.test(tag)) options.heading = Number(tag[1]);
      if (node.classList?.contains('poetry') || tag === 'pre') options.poetry = true;
      let pending = [];
      const flush = () => { emit(pending, options); pending = []; };
      for (const child of node.childNodes) {
        if (/^(p|div|h[1-6]|ul|ol|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|hr)$/.test(child.localName)) { flush(); visit(child, options); }
        else pending.push(child);
      }
      flush();
    }
    visit(holder); return result;
  }
  function marker(p) { return p.list ? '  '.repeat(p.list.depth) + (p.list.ordered ? `${p.list.number}. ` : '• ') : ''; }
  return { runs, inline, html, paragraphs, marker };
})();
