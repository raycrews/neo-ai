// Shared local context picker; opening or previewing it makes no model request.
(() => {
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const btn = (text, fn) => { const node = el('button', '', text); node.type = 'button'; node.onclick = fn; return node; };
  class ChatContextPicker {
    constructor(view) {
      this.view = view; this.rows = null; this.dirty = true;
      this.dialog = el('dialog', 'ai-context-dialog'); this.dialog.setAttribute('aria-label', 'Choose AI context');
      const header = el('header', 'ai-picker-header'); header.append(el('h2', '', 'Choose AI context'));
      this.refreshButton = btn('Refresh', () => this.refresh().catch(error => this.fail(error))); header.append(this.refreshButton);
      this.dialog.append(header, el('p', 'ai-caption', 'Choose documents for this chat. Text is refreshed from the workspace when you send. Folder and document exclusions apply; Darlings is always excluded.'));
      this.search = el('input'); this.search.type = 'search'; this.search.placeholder = 'Find a document…'; this.search.setAttribute('aria-label', 'Find context documents'); this.search.oninput = () => this.renderList();
      this.clear = btn('Clear selection', () => { this.ids.clear(); this.renderList(); this.renderPreview(); });
      const filter = el('div', 'ai-picker-filter'); filter.append(this.search, this.clear); this.dialog.append(filter);
      const columns = el('div', 'ai-picker-columns');
      this.list = el('div', 'ai-picker-list'); this.list.setAttribute('aria-label', 'Book documents');
      const preview = el('section', 'ai-picker-preview'); preview.append(el('h3', '', 'Selected text preview'));
      this.count = el('p', 'ai-caption'); this.text = el('div'); preview.append(this.count, this.text); columns.append(this.list, preview); this.dialog.append(columns);
      this.status = el('p', 'ai-status'); this.status.setAttribute('role', 'status'); this.dialog.append(this.status);
      const footer = el('footer', 'ai-picker-footer');
      this.cancel = btn('Cancel', () => this.dialog.close());
      this.apply = btn('Use selected context', () => this.save()); this.apply.className = 'ai-primary'; footer.append(this.cancel, this.apply); this.dialog.append(footer);
      this.dialog.onclose = () => { clearTimeout(this.timer); this.view.contextButton.focus(); };
      view.root.append(this.dialog);
    }
    reset() { clearTimeout(this.timer); this.dialog.close(); this.rows = null; this.dirty = true; this.loading = false; this.epoch = (this.epoch || 0) + 1; }
    invalidate(revision) {
      if (revision === this.revision) return;
      this.revision = revision; this.dirty = true;
      if (this.dialog.open) { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh().catch(error => this.fail(error)), 300); }
      this.view.renderContext();
    }
    async open() {
      const c = this.view.current(); if (!c || this.view.detached || this.view.requestBusy || this.view.state.job) return;
      this.conversationId = c.id; this.ids = new Set(c.contextIds || []); this.search.value = ''; this.status.textContent = '';
      this.dialog.showModal(); this.list.textContent = 'Loading documents…'; this.text.replaceChildren();
      await this.refresh().catch(error => this.fail(error));
      if (this.dialog.open) this.search.focus();
    }
    fail(error) { this.status.classList.add('ai-error'); this.status.textContent = error.message; }
    async refresh() {
      const bookId = this.view.bookId;
      if (!bookId || this.loading) return;
      const epoch = this.epoch;
      let succeeded = false;
      this.loading = true; this.refreshButton.disabled = true; this.apply.disabled = true;
      try {
        const rows = await this.view.unwrap(window.neoChat.context(bookId));
        if (this.view.bookId !== bookId || this.epoch !== epoch) return;
        this.rows = rows; this.dirty = false;
        succeeded = true;
        this.status.classList.remove('ai-error'); this.status.textContent = '';
        if (this.dialog.open) { this.renderList(); this.renderPreview(); }
        this.view.renderContext();
      } finally {
        if (this.epoch === epoch) { this.loading = false; this.refreshButton.disabled = false; this.apply.disabled = !succeeded || this.view.detached || !!this.view.state?.job; }
      }
    }
    renderList() {
      this.list.replaceChildren();
      const query = this.search.value.trim().toLowerCase(); let section;
      for (const row of this.rows || []) {
        if (query && !row.path.toLowerCase().includes(query)) continue;
        if (section !== row.section) { section = row.section; this.list.append(el('h3', '', ChatContext.labels[section])); }
        const label = el('label', 'ai-source-row');
        const input = el('input'); input.type = 'checkbox'; input.checked = this.ids.has(row.id); input.disabled = !row.enabled; input.dataset.contextId = row.id;
        input.onchange = () => { input.checked ? this.ids.add(row.id) : this.ids.delete(row.id); this.renderPreview(); };
        const description = el('span'); description.append(el('strong', '', row.title), el('small', '', row.path));
        if (!row.enabled) { label.classList.add('ai-source-excluded'); description.append(el('small', 'ai-error', row.reason)); }
        label.append(input, description); this.list.append(label);
      }
      if (!this.list.childNodes.length) this.list.append(el('p', 'ai-caption', query ? 'No matching documents.' : 'Create documents in the navigation pane to use them here.'));
    }
    renderPreview() {
      const { sources, omitted } = ChatContext.resolve(this.rows || [], [...this.ids]);
      const tokens = Math.ceil(sources.reduce((sum, row) => sum + row.text.length + row.path.length, 0) / 4);
      this.count.textContent = sources.length + (sources.length === 1 ? ' document' : ' documents') + ' · ~' + tokens.toLocaleString() + ' source tokens (estimate)' + (omitted.length ? ' · ' + omitted.length + ' excluded or missing selections' : '');
      this.text.replaceChildren();
      if (!sources.length) this.text.append(el('p', 'ai-caption', 'No document text will be attached.'));
      for (const row of sources) {
        const detail = el('details'); detail.open = sources.length === 1;
        detail.append(el('summary', '', row.path), el('pre', '', row.text || '(Empty document)')); this.text.append(detail);
      }
      if (omitted.length) this.text.append(el('p', 'ai-caption', 'Excluded and deleted documents will not be sent. Clear selection to remove them from this chat’s choices.'));
      this.text.append(el('p', 'ai-caption', 'Earlier chat replies and summaries may still discuss documents used previously. Start a new chat if you need a conversation without that material.'));
    }
    async save() {
      if (this.loading || !this.rows || this.view.current()?.id !== this.conversationId) return;
      this.apply.disabled = true;
      const state = await this.view.run({ type: 'context', id: this.conversationId, ids: [...this.ids] });
      if (state) { this.dialog.close(); this.view.status.textContent = 'Context selection saved for this chat.'; }
      else this.fail(new Error(this.view.status.textContent || 'Could not save the selection.'));
      this.apply.disabled = false;
    }
  }
  window.ChatContextPicker = ChatContextPicker;
})();
