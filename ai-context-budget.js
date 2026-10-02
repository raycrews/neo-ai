// Read-only estimates use the same history and source assembly as Send.
(() => {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const number = n => n.toLocaleString();
  class ChatBudgetView {
    constructor(view) {
      this.view = view;
      this.root = el('section', 'ai-budget');
      this.label = el('p', 'ai-budget-label', 'Estimating context…');
      this.meter = el('progress'); this.meter.setAttribute('aria-label', 'Estimated context use including reply space'); this.meter.hidden = true;
      this.note = el('p', 'ai-caption');
      this.details = el('dialog', 'ai-budget-dialog'); this.details.setAttribute('aria-label', 'AI context details');
      this.detailsButton = el('button', 'ai-budget-details-button', 'Context details'); this.detailsButton.type = 'button';
      this.detailsButton.onclick = () => { this.details.showModal(); this.schedule(true); };
      const heading = el('header', 'ai-picker-header'); heading.append(el('h2', '', 'Context details'));
      const close = el('button', '', 'Close'); close.type = 'button'; close.onclick = () => this.details.close(); heading.append(close);
      const body = el('div', 'ai-budget-dialog-body'); this.details.append(heading, body);
      this.details.onclose = () => this.detailsButton.focus();
      this.breakdown = el('dl', 'ai-budget-breakdown');
      this.sources = el('div', 'ai-budget-sources');
      this.limitLabel = el('label', 'ai-limit-label', 'Context limit override (tokens)');
      this.limit = el('input'); this.limit.type = 'number'; this.limit.min = '512'; this.limit.max = '10000000'; this.limit.step = '1'; this.limit.placeholder = 'Use discovered limit'; this.limitLabel.append(this.limit);
      this.save = el('button', '', 'Save limit'); this.save.type = 'button'; this.save.onclick = () => this.saveLimit();
      this.limitRow = el('div', 'ai-limit-row'); this.limitRow.append(this.limitLabel, this.save);
      this.feedback = el('p', 'ai-caption'); this.feedback.setAttribute('role', 'status');
      body.append(this.root, this.breakdown, this.sources, this.limitRow,
        el('p', 'ai-caption', 'Saved for this connection and model on this device. Leave blank to use discovery. For a local model, enter the context size loaded in your server.'), this.feedback,
        el('p', 'ai-caption', 'Estimates use roughly four characters per token plus message overhead. Actual use varies by model and language. Selected documents are refreshed when you send. Compaction is manual; the original chat remains readable and exportable.'));
      this.root.append(this.label, this.meter, this.note);
      view.root.append(this.details);
      this.comparison = el('p', 'ai-caption'); view.preview.insertBefore(this.comparison, view.summaryText);
      window.neoChat.onContextChanged(() => view.refreshConnections());
    }
    reset() { clearTimeout(this.timer); this.details.close(); this.key = null; this.serial = (this.serial || 0) + 1; this.report = null; }
    controls() {
      const c = this.view.current();
      const disabled = !c?.model || !c?.profileId || this.view.detached || this.view.requestBusy || !!this.view.state?.job || this.saving;
      this.limit.disabled = !!disabled; this.save.disabled = !!disabled;
      if (this.view.detached && this.details.open) this.details.close();
      this.detailsButton.disabled = !c || this.view.detached;
    }
    schedule(force = false) {
      const v = this.view, c = v.current(); this.root.hidden = !c;
      this.controls();
      if (!c) { this.reset(); return; }
      if (v.state?.job) { this.note.textContent = 'Estimate updates when the reply or summary finishes.'; return; }
      const key = JSON.stringify([v.bookId, c, v.draft.value, v.summaryText.value, v.contextPicker?.revision, v.profiles]);
      if (!force && key === this.key) return;
      this.key = key; clearTimeout(this.timer); const serial = this.serial = (this.serial || 0) + 1;
      this.report = null;
      this.label.textContent = 'Updating context estimate…'; this.meter.hidden = true;
      this.note.textContent = ''; this.comparison.textContent = c.preview?.status === 'complete' ? 'Updating comparison…' : '';
      this.timer = setTimeout(() => this.refresh(serial), 250);
    }
    async refresh(serial) {
      const v = this.view, c = v.current(), bookId = v.bookId;
      if (!c || v.state?.job) return;
      try {
        const report = await v.unwrap(window.neoChat.budget(bookId, c.id, v.draft.value, c.preview?.status === 'complete' ? v.summaryText.value : undefined));
        if (serial !== this.serial || bookId !== v.bookId || c.id !== v.current()?.id || v.state?.job) return;
        this.report = report; this.render(report);
      } catch (error) {
        if (serial !== this.serial) return;
        this.report = null; this.label.textContent = 'Context estimate unavailable'; this.meter.hidden = true;
        this.note.textContent = error.message; this.breakdown.replaceChildren(); this.sources.replaceChildren();
        this.comparison.textContent = 'Estimate unavailable. Your original messages remain saved.';
      }
    }
    render({ current: b, proposed, capacity }) {
      const v = this.view, c = v.current();
      const percent = b.limit ? Math.round(b.total / b.limit * 100) : null;
      this.label.textContent = b.limit
        ? `~${number(b.total)} / ${number(b.limit)} tokens · ${number(percent)}% including reply space`
        : `~${number(b.input)} input tokens · context limit unknown`;
      this.meter.hidden = !b.limit;
      if (b.limit) { this.meter.max = b.limit; this.meter.value = Math.min(b.total, b.limit); this.meter.setAttribute('aria-valuetext', this.label.textContent); }
      this.root.classList.toggle('ai-budget-warning', !!b.limit && b.total >= b.limit * .85);
      const source = capacity.source === 'manual' ? 'Manual limit' : capacity.source === 'loaded' ? 'Loaded context reported by LM Studio' : 'Server-reported limit';
      const stamp = capacity.checkedAt ? ' · discovered ' + new Date(capacity.checkedAt).toLocaleString() : '';
      this.note.textContent = b.limit
        ? `${source}${stamp}. ${b.remaining < 0 ? '~' + number(-b.remaining) + ' tokens over budget. Choose fewer documents or compact manually.' : '~' + number(b.remaining) + ' tokens remain after reserving ' + number(b.reply) + ' for the reply.'}`
        : `Discover models or set a limit in Context details. ${number(b.reply)} additional tokens are reserved for the reply.`;
      this.breakdown.replaceChildren();
      for (const [label, value] of [
        ['Assistant instructions', b.parts.instructions], ['Selected documents and source labels', b.parts.documents],
        ['Conversation summary', b.parts.summary], ['Recent messages (' + b.recentMessages + ')', b.parts.recent],
        ['Current draft', b.parts.draft], ['Message overhead allowance', b.parts.overhead],
        ['Estimated input total', b.input], ['Reserved for reply (Settings → AI Connections)', b.reply]
      ]) this.breakdown.append(el('dt', '', label), el('dd', '', '~' + number(value)));
      this.sources.replaceChildren(el('p', 'ai-caption', 'Selected for the next message: ' + b.sources.length + (b.sources.length === 1 ? ' document' : ' documents') + (b.omitted ? ' · ' + b.omitted + ' excluded or missing selections' : '') + (b.summarizedMessages ? ' · ' + b.summarizedMessages + ' older messages represented by the summary' : '')));
      for (const row of b.sources) this.sources.append(el('p', '', row.path + ' · ~' + number(row.tokens) + ' text tokens'));
      const configKey = JSON.stringify([c.profileId, c.model]);
      if (configKey !== this.configKey) { this.limitDirty = false; this.feedback.textContent = ''; this.configKey = configKey; this.limit.value = capacity.source === 'manual' ? capacity.limit : ''; }
      else if (document.activeElement !== this.limit && !this.limitDirty) this.limit.value = capacity.source === 'manual' ? capacity.limit : '';
      this.limit.oninput = () => { this.limitDirty = true; };
      if (proposed) {
        const saved = b.input - proposed.input;
        this.comparison.textContent = `Estimated input: ${number(b.input)} → ${number(proposed.input)} tokens (${saved >= 0 ? number(saved) + ' fewer' : number(-saved) + ' more'}). ${proposed.summarizedMessages} older messages will be represented by this summary; ${proposed.recentMessages} recent messages stay in full. Selected documents stay attached. Nothing changes until you choose Use this summary.`;
      } else this.comparison.textContent = '';
    }
    async saveLimit() {
      const v = this.view, c = v.current(); if (!c || this.save.disabled) return;
      if (!this.limit.checkValidity()) { this.limit.reportValidity(); return; }
      const value = this.limit.value.trim() ? Number(this.limit.value) : null;
      const bookId = v.bookId, configKey = JSON.stringify([c.profileId, c.model]);
      this.saving = true; this.controls();
      try {
        const settings = await v.unwrap(window.neoChat.setContextLimit(bookId, c.profileId, c.model, value));
        if (bookId !== v.bookId || configKey !== JSON.stringify([v.current()?.profileId, v.current()?.model])) return;
        this.limitDirty = false; v.setConnections(settings); v.render();
        this.feedback.textContent = value === null ? 'Using discovery when a limit is available.' : 'Context limit saved.';
        this.schedule(true);
      } catch (error) { this.feedback.textContent = error.message; }
      finally { this.saving = false; this.controls(); }
    }
  }
  window.ChatBudgetView = ChatBudgetView;
})();
