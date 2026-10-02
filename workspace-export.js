(() => {
  const dialog = document.createElement('dialog'); dialog.id = 'manuscript-export-dialog';
  dialog.setAttribute('aria-labelledby', 'manuscript-export-title');
  dialog.innerHTML = `<header><h2 id="manuscript-export-title">Export book</h2><button type="button" data-action="cancel">Cancel</button></header>
    <p data-book></p><p>Documents export in sidebar order. Manuscript folders become chapters; their documents become scenes.</p>
    <div class="export-controls"><label>Headings<select data-headings><option value="folders">Chapter folder titles</option><option value="documents">Each document title</option><option value="none">No headings</option></select></label>
    <label><input type="checkbox" data-breaks checked> Scene breaks between documents in a chapter</label></div>
    <div class="export-controls"><label>Chapter numbering<select data-numbering><option value="named">As named</option><option value="arabic">Arabic (1, 2, 3)</option><option value="roman">Roman (I, II, III)</option></select></label><span data-numbering-help>Numbers follow the selected manuscript chapters, starting at 1. Reference documents keep their titles.</span></div>
    <div class="export-controls" data-pagination hidden><label><input type="checkbox" data-page-numbers> Page numbers</label><span>Bottom center. Start at 1 on the first chapter; cover and title page stay unnumbered.</span></div>
    <div class="export-controls"><button type="button" data-action="manuscript">Manuscript only</button><button type="button" data-action="all">Select all</button><button type="button" data-action="none">Clear selection</button></div>
    <div data-documents aria-label="Documents to export"></div>
    <details><summary>Export order and headings</summary><ol data-preview></ol></details>
    <footer><span data-status role="status"></span><button type="button" data-action="export">Choose file…</button></footer>`;
  document.body.append(dialog);
  let finish, rows = [], selected = new Set();
  const mode = dialog.querySelector('[data-headings]'), breaks = dialog.querySelector('[data-breaks]');
  const pagination = dialog.querySelector('[data-pagination]'), pageNumbers = dialog.querySelector('[data-page-numbers]');
  const numbering = dialog.querySelector('[data-numbering]');
  function refresh() {
    dialog.querySelectorAll('[data-documents] input').forEach(input => { input.checked = selected.has(input.value); });
    numbering.disabled = mode.value === 'none';
    dialog.querySelector('[data-numbering-help]').textContent = numbering.disabled ? 'Choose a heading style to add chapter numbers.' : numbering.value === 'named' ? 'Use the current chapter titles unchanged.' : 'Numbers follow the selected manuscript chapters, starting at 1. Reference documents keep their titles.';
    const groups = ManuscriptExport.sections(rows, selected, mode.value, breaks.checked, () => [], numbering.value);
    dialog.querySelector('[data-status]').textContent = `${selected.size} document${selected.size === 1 ? '' : 's'} · ${groups.length} chapter${groups.length === 1 ? '' : 's'}`;
    dialog.querySelector('[data-action=export]').disabled = !selected.size;
    const preview = dialog.querySelector('[data-preview]'); preview.replaceChildren();
    for (const group of groups) { const item = document.createElement('li'); item.textContent = (group.heading || '(No heading)') + ' — ' + group.documents.join(', '); preview.append(item); }
  }
  dialog.addEventListener('close', () => { const resolve = finish; finish = null; resolve?.(null); });
  dialog.querySelector('[data-action=cancel]').onclick = () => dialog.close();
  for (const action of ['manuscript', 'all', 'none']) dialog.querySelector(`[data-action=${action}]`).onclick = () => {
    selected = new Set(rows.filter(r => action === 'all' || action === 'manuscript' && r.section === 'manuscript').map(r => r.id)); refresh();
  };
  mode.onchange = refresh; breaks.onchange = refresh; numbering.onchange = refresh;
  dialog.querySelector('[data-action=export]').onclick = () => {
    const resolve = finish; finish = null;
    resolve?.({ rows, selected, mode: mode.value, breaks: breaks.checked, numbering: numbering.value, pageNumbers: !pagination.hidden && pageNumbers.checked }); dialog.close();
  };
  window.chooseBookExport = format => {
    if (dialog.open || document.querySelector('dialog[open]')) return Promise.resolve(null);
    WorkspaceTree.reconcile(book); rows = ManuscriptExport.catalog(book);
    selected = new Set(rows.filter(r => r.section === 'manuscript').map(r => r.id));
    mode.value = 'folders'; breaks.checked = true; numbering.value = 'named';
    pagination.hidden = !['pdf', 'docx'].includes(format); pageNumbers.checked = false;
    dialog.querySelector('[data-book]').textContent = `${book.title} · ${format.toUpperCase()}`;
    const list = dialog.querySelector('[data-documents]'); list.replaceChildren(); let section;
    for (const row of rows) {
      if (section !== row.section) { section = row.section; const title = document.createElement('h3'); title.textContent = sectionLabels[section] || section; list.append(title); }
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id;
      input.onchange = () => { if (input.checked) selected.add(row.id); else selected.delete(row.id); refresh(); };
      label.append(input, document.createTextNode(row.path)); list.append(label);
    }
    refresh(); dialog.showModal();
    return new Promise(resolve => { finish = resolve; });
  };
})();
