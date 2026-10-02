// Shared view for the writing workspace and its detachable chat window.
// Replies use the restricted Markdown renderer; source messages stay literal.
(() => {
  const element = (tag, className, text) => {
    const el = document.createElement(tag); if (className) el.className = className;
    if (text !== undefined) el.textContent = text; return el;
  };
  const button = (label, fn) => {
    const el = element('button', '', label); el.type = 'button'; el.onclick = fn; return el;
  };
  const option = (value, label) => { const el = element('option', '', label); el.value = value; return el; };
  class NeoChatView {
    constructor(root, { detach, settings, dock } = {}) {
      this.root = root; root.classList.add('ai-chat');
      this.bookId = null; this.state = null; this.profiles = [];
      this.pending = Promise.resolve(); this.draftTimer = null; this.summaryTimer = null; this.requestBusy = false;
      this.formattedMessages = new Map();
      window.neoChat.onReveal?.(target => {
        if (target.bookId !== this.bookId) return;
        this.searchHighlight = target; this.searchReveal = target; this.revealSearchMessage();
      });
      root.setAttribute('aria-label', 'AI Assistance');
      if (detach) this.detachButton = button('Open in separate window', detach);
      if (dock) this.dockButton = button('Return to workspace', dock);
      this.notice = element('p', 'ai-detached', 'Chat is open in its separate window.'); this.notice.hidden = true;
      this.controls = element('div', 'ai-chat-controls');
      this.conversation = element('select'); this.conversation.setAttribute('aria-label', 'Conversation');
      this.newButton = button('+ New chat', () => this.run({ type: 'new' }));
      this.name = element('input'); this.name.maxLength = 100; this.name.setAttribute('aria-label', 'Conversation name');
      this.name.onchange = () => this.run({ type: 'rename', id: this.current()?.id, text: this.name.value });
      this.conversation.onchange = () => this.run({ type: 'select', id: this.conversation.value });
      const conversations = element('div', 'ai-control-row'); conversations.append(this.conversation, this.newButton, this.name);
      this.assistant = element('select'); this.assistant.setAttribute('aria-label', 'Assistant type');
      this.assistant.append(...AssistantTypes.map(type => option(type.id, type.name)));
      this.assistant.onchange = () => this.run({ type: 'assistant', id: this.current()?.id, assistantType: this.assistant.value });
      const purpose = element('div', 'ai-purpose');
      const purposeLabel = element('label'); purposeLabel.append(element('span', 'ai-caption', 'Assistant type'), this.assistant);
      purpose.append(purposeLabel, element('span', 'ai-caption', 'Edit instructions in Settings → AI.'));
      const windowButton = this.detachButton || this.dockButton;
      if (windowButton) { windowButton.classList.add('ai-window-button'); purpose.append(windowButton); }
      this.connection = element('select'); this.connection.setAttribute('aria-label', 'Connection');
      this.model = element('select', 'ai-model-select'); this.model.setAttribute('aria-label', 'Model');
      this.model.title = 'Discover models refreshes this list.';
      this.model.onchange = () => {
        if (this.model.selectedOptions[0]?.dataset.manual) {
          this.renderModels(); this.manualModel.value = this.current()?.model || '';
          this.modelDialog.showModal(); this.manualModel.focus(); this.manualModel.select();
        } else this.saveConfig();
      };
      this.connection.onchange = () => {
        this.renderModels(this.profiles.find(p => p.id === this.connection.value)?.model || '');
        this.saveConfig(); this.renderConnectionNotice();
      };
      this.discover = button('Discover models', () => this.discoverModels());
      const connections = element('div', 'ai-control-row'); connections.append(this.connection, this.model, this.discover);
      if (settings) connections.append(button('Connections…', settings));
      this.connectionNotice = element('p', 'ai-caption');
      this.controls.append(conversations, purpose, connections, this.connectionNotice);
      this.modelDialog = element('dialog', 'ai-model-dialog'); this.modelDialog.setAttribute('aria-label', 'Enter model ID');
      const modelForm = element('form');
      const modelLabel = element('label', '', 'Exact model ID');
      this.manualModel = element('input'); this.manualModel.required = true; this.manualModel.maxLength = 200;
      modelLabel.append(this.manualModel);
      const modelActions = element('div', 'ai-control-row');
      const cancelModel = button('Cancel', () => this.modelDialog.close());
      const useModel = element('button', 'ai-primary', 'Use model'); useModel.type = 'submit';
      modelActions.append(cancelModel, useModel);
      modelForm.append(element('h2', '', 'Enter model ID'), modelLabel, modelActions);
      modelForm.onsubmit = event => {
        event.preventDefault(); const value = this.manualModel.value.trim(); if (!value) return;
        this.renderModels(value); this.modelDialog.close(); this.saveConfig();
      };
      this.modelDialog.append(modelForm); root.append(this.modelDialog);
      this.modelDialog.onclose = () => this.model.focus();
      this.editDialog = element('dialog', 'ai-edit-dialog'); this.editDialog.setAttribute('aria-label', 'Edit and resend prompt');
      const editForm = element('form');
      this.editPrompt = element('textarea'); this.editPrompt.rows = 8; this.editPrompt.maxLength = 100000; this.editPrompt.required = true;
      this.editPrompt.setAttribute('aria-label', 'Revised prompt');
      const editActions = element('div', 'ai-control-row');
      const cancelEdit = button('Cancel', () => this.editDialog.close());
      const resend = element('button', 'ai-primary', 'Send as new chat'); resend.type = 'submit';
      editActions.append(cancelEdit, resend);
      editForm.append(element('h2', '', 'Edit and resend'), this.editPrompt,
        element('p', 'ai-caption', 'Starts a new chat from this prompt. The original conversation stays saved. Uses the current model, instructions and chosen documents.'), editActions);
      editForm.onsubmit = event => {
        event.preventDefault(); if (!this.editPrompt.value.trim()) return;
        const action = { type: 'resend', id: this.current().id, messageId: this.editMessageId, text: this.editPrompt.value };
        this.editDialog.close(); this.run(action);
      };
      this.editDialog.append(editForm); root.append(this.editDialog);
      this.context = element('div', 'ai-context');
      this.contextLabel = element('span', '', 'Context: chat history only');
      this.tokens = element('span');
      this.contextButton = button('Choose context', () => this.contextPicker.open());
      this.compact = button('Compact conversation', () => this.run({ type: 'compact', id: this.current()?.id }));
      this.exportButton = button('Export chat', () => this.exportChat());
      this.exportButton.title = 'Save the full conversation as a document in Notes';
      this.restore = button('Restore full history', () => this.run({ type: 'restore', id: this.current()?.id }));
      this.context.append(this.contextLabel, this.tokens, this.contextButton, this.compact, this.exportButton, this.restore);
      this.summary = element('details', 'ai-summary'); this.summary.append(element('summary', '', 'Active conversation summary'));
      this.activeSummary = element('p'); this.summary.append(this.activeSummary); this.summary.hidden = true;
      this.preview = element('section', 'ai-summary-preview'); this.preview.hidden = true;
      this.preview.append(element('h2', '', 'Review the summary'));
      this.preview.append(element('p', 'ai-caption', 'Original messages stay saved. Applying this summary sends it with the recent conversation on future requests.'));
      this.summaryText = element('textarea'); this.summaryText.rows = 7; this.summaryText.maxLength = 100000;
      this.summaryText.setAttribute('aria-label', 'Compaction summary');
      this.summaryText.oninput = () => {
        this.budgetView.schedule();
        clearTimeout(this.summaryTimer);
        this.summaryTimer = setTimeout(() => this.saveSummary().catch(error => this.error(error)), 350);
      };
      this.apply = button('Use this summary', async () => { await this.flushEdits(); await this.run({ type: 'applySummary', id: this.current()?.id, text: this.summaryText.value }); });
      this.discard = button('Discard summary', () => this.run({ type: 'discardSummary', id: this.current()?.id }));
      this.preview.append(this.summaryText, this.apply, this.discard);
      this.transcript = element('div', 'ai-transcript'); this.transcript.setAttribute('aria-label', 'Conversation messages');
      this.transcript.setAttribute('tabindex', '0');
      this.status = element('p', 'ai-status'); this.status.setAttribute('role', 'status');
      this.composer = element('form', 'ai-composer');
      this.draft = element('textarea'); this.draft.rows = 3; this.draft.maxLength = 100000;
      this.draft.placeholder = 'Brainstorm an idea, ask a question, or develop your story…'; this.draft.setAttribute('aria-label', 'Message');
      this.draft.oninput = () => { this.budgetView.schedule(); this.draftDirty = true; clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.saveDraft().catch(error => this.error(error)), 350); };
      this.draft.onkeydown = event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) this.send();
      };
      const actions = element('div', 'ai-composer-actions');
      this.sendButton = button('Send', () => this.send()); this.sendButton.className = 'ai-primary';
      this.stopButton = button('Stop', () => this.run({ type: 'stop' }));
      actions.append(element('span', 'ai-caption', 'Enter to send · Shift+Enter for a new line'), this.stopButton, this.sendButton);
      this.composer.onsubmit = event => { event.preventDefault(); this.send(); };
      this.composer.append(this.draft, actions);
      this.options = element('div', 'ai-chat-options');
      this.options.append(this.controls, this.context, this.summary, this.preview);
      root.append(this.notice, this.options, this.transcript, this.status, this.composer);
      this.contextPicker = new ChatContextPicker(this);
      this.budgetView = new ChatBudgetView(this);
      this.contextButton.after(this.budgetView.detailsButton);
      window.neoChat.onState(({ bookId, state }) => { if (bookId === this.bookId) { this.state = state; this.renderButtons(); this.scheduleRender(); } });
    }
    chatConversations() { return (this.state?.conversations || []).filter(c => !c.navigationLinked || this.navigation?.some(node => node.id === c.id)); }
    current() { const chats = this.chatConversations(); return chats.find(c => c.id === this.state?.selectedId) || chats[0]; }
    setNavigation(nodes) { this.navigation = nodes || []; this.render(); }
    async unwrap(promise) { const result = await promise; if (result.error) throw new Error(result.error); return result.value; }
    error(error) { this.status.textContent = error.message; this.status.classList.add('ai-error'); }
    enqueue(action) {
      const bookId = this.bookId;
      const operation = this.pending.then(async () => {
        const state = await this.unwrap(window.neoChat.action(bookId, action));
        this.saveFailure = null;
        if (bookId === this.bookId) { this.state = state; this.render(); } return state;
      });
      this.pending = operation.catch(error => { this.saveFailure = error; this.error(error); });
      return operation;
    }
    async run(action) {
      if (!this.bookId) return;
      this.requestBusy = true; this.status.classList.remove('ai-error'); this.status.textContent = ''; this.renderButtons();
      try { await this.flushEdits(); return await this.enqueue(action); }
      catch (error) { this.error(error); }
      finally { this.requestBusy = false; this.renderButtons(); }
    }
    async showBook(bookId, title, create = true) {
      if (this.loadingBook?.bookId === bookId) {
        await this.loadingBook.promise;
        if (create && bookId && this.bookId === bookId && this.state && !this.state.conversations.length) await this.run({ type: 'new' });
        return;
      }
      const promise = this.loadBook(bookId, title, create);
      const loading = { bookId, promise }; this.loadingBook = loading;
      try { await promise; } finally { if (this.loadingBook === loading) this.loadingBook = null; }
    }
    async loadBook(bookId, title, create) {
      this.root.setAttribute('aria-label', title ? 'AI Assistance for ' + title : 'AI Assistance');
      if (bookId === this.bookId && this.state) {
        await this.refreshConnections();
        if (create && !this.state.conversations.length) await this.run({ type: 'new' });
        return;
      }
      const old = this.bookId;
      if (old && old !== bookId) await this.flushEdits();
      this.contextPicker.reset(); this.budgetView.reset(); this.modelDialog.close(); this.editDialog.close();
      this.bookId = bookId; this.state = null; this.viewedId = null; this.transcript.replaceChildren();
      this.formattedMessages.clear();
      this.draft.value = ''; this.draftDirty = false; this.status.textContent = bookId ? 'Loading conversations…' : 'Open a book to start a conversation.';
      this.renderButtons();
      if (!bookId) return;
      try {
        const [state, connections] = await Promise.all([
          this.unwrap(window.neoChat.read(bookId)), this.unwrap(window.neoChat.connections(bookId))
        ]);
        if (this.bookId !== bookId) return;
        this.state = state; this.setConnections(connections); this.status.textContent = ''; this.render();
        if (create && !this.state.conversations.length) await this.run({ type: 'new' });
      } catch (error) { this.error(error); }
    }
    async refreshConnections() {
      const bookId = this.bookId; if (!bookId) return;
      try { const settings = await this.unwrap(window.neoChat.connections(bookId)); if (this.bookId === bookId) { this.setConnections(settings); this.render(); this.budgetView.schedule(true); } }
      catch (error) { this.error(error); }
    }
    setConnections(settings) {
      this.profiles = settings.profiles;
      this.connection.replaceChildren(option('', settings.profiles.length ? 'Choose connection' : 'Add a connection in Settings'));
      for (const p of this.profiles) this.connection.append(option(p.id, p.name));
    }
    saveConfig() {
      if (this.current()) return this.run({ type: 'config', id: this.current().id, profileId: this.connection.value, model: this.model.value });
    }
    async discoverModels() {
      const bookId = this.bookId, profileId = this.connection.value;
      if (!profileId) return this.error(new Error('Choose a connection first.'));
      this.discover.disabled = true; this.status.textContent = 'Discovering models…'; this.status.classList.remove('ai-error');
      try {
        const result = await this.unwrap(window.neoChat.models(bookId, profileId));
        if (bookId !== this.bookId || profileId !== this.connection.value) return;
        await this.refreshConnections(); this.renderModels(); this.status.textContent = result.models.length + ' models available. Choose one from the list.';
      } catch (error) { this.error(error); }
      finally { this.renderButtons(); }
    }
    renderModels(selected = this.current()?.model || '') {
      const p = this.profiles.find(p => p.id === this.connection.value);
      const models = p?.discoveredModels || [];
      const placeholder = option('', models.length ? 'Choose a model' : 'Discover models to refresh the list');
      placeholder.disabled = true;
      this.model.replaceChildren(placeholder);
      for (const model of models) this.model.append(option(model, model));
      if (selected && !models.includes(selected)) this.model.append(option(selected, selected + ' (current model)'));
      const manual = option('', 'Enter model ID…'); manual.dataset.manual = 'true';
      this.model.append(manual); this.model.value = selected;
    }
    renderConnectionNotice() {
      const p = this.profiles.find(p => p.id === this.connection.value);
      this.connectionNotice.textContent = p ? (p.keyStatus === 'unavailable' ? 'Key unavailable; update it in Settings.' : '') : 'Create a connection in Settings to start chatting.';
      this.connectionNotice.hidden = !this.connectionNotice.textContent;
    }
    saveDraft() {
      clearTimeout(this.draftTimer); this.draftTimer = null;
      const c = this.current();
      if (!c || this.detached || this.draft.value === c.draft) return this.pending;
      const text = this.draft.value;
      return this.enqueue({ type: 'draft', id: c.id, text }).then(state => {
        if (this.current()?.id === c.id && this.draft.value === text) this.draftDirty = false;
        return state;
      });
    }
    saveSummary() {
      clearTimeout(this.summaryTimer); this.summaryTimer = null;
      const c = this.current();
      if (!c?.preview || this.detached || c.preview.status !== 'complete' || this.summaryText.value === c.preview.text) return this.pending;
      return this.enqueue({ type: 'previewEdit', id: c.id, text: this.summaryText.value });
    }
    revealSearchMessage() {
      const target = this.searchReveal;
      if (!target || this.current()?.id !== target.id) return;
      const card = [...this.transcript.children].find(el => el.dataset.messageId === target.messageId);
      if (!card) return;
      this.searchReveal = null;
      card.classList.add('ai-search-match');
      this.transcript.scrollTop = card.offsetTop - this.transcript.offsetTop;
      card.tabIndex = -1; card.focus({ preventScroll: true });
    }
    async flushEdits() {
      await this.saveDraft(); await this.saveSummary(); await this.pending;
      if (this.saveFailure) { const error = this.saveFailure; this.saveFailure = null; throw error; }
    }
    async flush() {
      await this.flushEdits();
      if (this.bookId) await this.unwrap(window.neoChat.flush(this.bookId));
    }
    async send() {
      if (this.state?.job || this.requestBusy || this.detached) return;
      const c = this.current(); if (!c) return;
      try {
        await this.flushEdits();
        const text = this.draft.value;
        if (!text.trim()) return;
        const result = await this.run({ type: 'send', id: c.id, text });
        if (result) { this.draft.value = ''; this.draftDirty = false; }
        // A failed request before the user turn was saved must keep the draft.
        else this.draft.value = text;
      } catch (error) { this.error(error); }
    }
    async exportChat() {
      const conversation = this.current(), bookId = this.bookId;
      if (!conversation || !conversation.messages.length || this.state.job || this.requestBusy || this.detached) return;
      this.requestBusy = true; this.renderButtons();
      this.status.classList.remove('ai-error'); this.status.textContent = 'Saving chat to Notes…';
      try {
        await this.flushEdits();
        const note = await this.unwrap(window.neoChat.exportConversation(bookId, conversation.id));
        if (this.bookId === bookId) this.status.textContent = 'Saved to Notes as “' + note.title + '”.';
      } catch (error) { this.error(error); }
      finally { this.requestBusy = false; this.renderButtons(); }
    }
    async copyMessage(message) {
      try {
        if (message.role === 'assistant') {
          const html = DocumentRichText.clean(ChatMarkdown.render(message.content));
          const text = DocumentRichText.plainText(html);
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          })]);
        } else await navigator.clipboard.writeText(message.content);
        this.status.textContent = 'Copied.';
      } catch { this.error(new Error('Could not copy this message.')); }
    }
    scheduleRender() { if (!this.renderTimer) this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, 40); }
    setDetached(value) {
      this.detached = value; this.notice.hidden = !value;
      if (this.detachButton) this.detachButton.textContent = value ? 'Show chat window' : 'Open in separate window';
      this.renderButtons();
    }
    renderButtons() {
      const busy = this.requestBusy || !!this.state?.job;
      const c = this.current(); const disabled = !c || this.detached;
      for (const control of [this.newButton, this.conversation, this.name, this.assistant, this.connection, this.model, this.discover]) control.disabled = disabled || busy;
      this.newButton.disabled = !this.state || this.detached || busy;
      this.model.disabled ||= !c?.profileId;
      if ((disabled || busy) && this.modelDialog.open) this.modelDialog.close();
      if ((disabled || busy) && this.editDialog.open) this.editDialog.close();
      for (const control of this.transcript.querySelectorAll('.ai-revise')) control.disabled = disabled || busy || !c?.model || !c?.profileId;
      this.draft.disabled = disabled || this.requestBusy;
      this.sendButton.disabled = disabled || busy || !c?.profileId || !c?.model;
      this.stopButton.hidden = !this.state?.job;
      this.stopButton.disabled = this.detached || this.requestBusy;
      const boundary = c?.summary ? c.messages.findIndex(m => m.id === c.summary.throughId) : -1;
      this.compact.disabled = disabled || busy || (c?.messages.length || 0) < 6 || c.messages.length - 5 <= boundary;
      this.exportButton.disabled = disabled || busy || !c?.messages.length;
      this.contextButton.disabled = disabled || busy;
      if (this.detached && this.contextPicker.dialog.open) this.contextPicker.dialog.close();
      this.restore.hidden = !c?.summary;
      this.restore.disabled = disabled || busy;
      this.summaryText.disabled = disabled || busy;
      this.budgetView?.controls();
      this.apply.disabled = disabled || busy || c?.preview?.status !== 'complete'; this.discard.disabled = disabled || busy;
    }
    render() {
      if (!this.state) { this.renderButtons(); return; }
      const c = this.current();
      this.conversation.replaceChildren(...this.chatConversations().map(c => option(c.id, c.title)));
      this.conversation.value = c?.id || '';
      if (!c) {
        this.transcript.replaceChildren(element('p', 'ai-empty', 'Create a chat from the AI Assistance menu or click New chat.'));
        this.draft.value = ''; this.name.value = ''; this.viewedId = null;
        this.contextLabel.textContent = 'Choose or create a chat'; this.tokens.textContent = ''; this.budgetView.schedule();
        this.summary.hidden = true; this.preview.hidden = true;
        this.renderButtons(); this.onNavigation?.(); return;
      }
      const changed = this.viewedId !== c.id; this.viewedId = c.id;
      this.assistant.value = c.assistantType || 'general';
      if (changed || (!this.draftDirty && document.activeElement !== this.draft && !this.draftTimer)) this.draft.value = c.draft || '';
      if (document.activeElement !== this.name) this.name.value = c.title;
      if (document.activeElement !== this.connection) this.connection.value = c.profileId;
      if (changed) { this.modelDialog.close(); this.editDialog.close(); }
      this.renderModels(c.model); this.renderConnectionNotice();
      this.summary.hidden = !c.summary; this.activeSummary.textContent = c.summary?.text || '';
      this.preview.hidden = !c.preview;
      const previewReady = c.preview?.status === 'complete' ? c.id + c.preview.throughId : null;
      if (previewReady && this.previewReady !== previewReady) requestAnimationFrame(() => {
        this.options.scrollTop += this.preview.getBoundingClientRect().top - this.options.getBoundingClientRect().top;
      });
      this.previewReady = previewReady;
      if (changed || this.state.job?.kind === 'compact' || (document.activeElement !== this.summaryText && !this.summaryTimer)) this.summaryText.value = c.preview?.text || '';
      const boundary = c.summary ? c.messages.findIndex(m => m.id === c.summary.throughId) : -1;
      this.renderContext();
      const bottom = changed || this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight < 70;
      this.transcript.replaceChildren();
      if (!c.messages.length) this.transcript.append(element('p', 'ai-empty', 'Start a conversation about your story. Use Choose context to attach manuscript or reference documents to this chat.'));
      for (const [index, message] of c.messages.entries()) {
        const card = element('article', 'ai-message ai-' + message.role);
        card.dataset.messageId = message.id;
        if (this.searchHighlight?.id === c.id && this.searchHighlight.messageId === message.id) card.classList.add('ai-search-match');
        const meta = element('div', 'ai-message-meta');
        meta.append(element('strong', '', message.role === 'user' ? 'You' : 'Assistant'),
          element('span', '', [index <= boundary ? 'Included in summary' : '', message.status === 'streaming' ? 'Writing…' : message.status === 'stopped' ? 'Stopped · partial reply' : message.model || ''].filter(Boolean).join(' · ')));
        const content = element('div', 'ai-message-content', message.content || (message.status === 'streaming' ? 'Waiting for the model…' : 'No text received.'));
        if (message.role === 'assistant' && message.content) {
          let formatted = this.formattedMessages.get(message.id);
          if (!formatted || formatted.source !== message.content) {
            formatted = { source: message.content, html: ChatMarkdown.render(message.content) };
            this.formattedMessages.set(message.id, formatted);
          }
          content.classList.add('ai-markdown');
          content.innerHTML = formatted.html;
        }
        card.append(meta, content);
        if (message.contextSources) {
          const sources = element('details', 'ai-sent-sources');
          sources.append(element('summary', '', 'Context: ' + message.contextSources.length + (message.contextSources.length === 1 ? ' document' : ' documents') + (message.contextOmitted ? ' · ' + message.contextOmitted + ' excluded or missing' : '')));
          for (const source of message.contextSources) sources.append(element('p', '', source.path));
          card.append(sources);
        }
        if (message.error) card.append(element('p', 'ai-error', message.error));
        if (message.content) card.append(button('Copy', () => this.copyMessage(message)));
        if (message.role === 'user' || c.messages[index - 1]?.role === 'user') {
          const revise = button(message.role === 'user' ? 'Edit and resend' : 'Retry response', () => {
            if (message.role === 'assistant') return this.run({ type: 'retry', id: c.id, messageId: message.id });
            this.editMessageId = message.id; this.editPrompt.value = message.content;
            this.editDialog.showModal(); this.editPrompt.focus();
          });
          revise.className = 'ai-revise';
          revise.title = 'Creates a new chat from this prompt using the current settings and context. The original stays saved.';
          card.append(revise);
        }

        this.transcript.append(card);
      }
      if (bottom) this.transcript.scrollTop = this.transcript.scrollHeight;
      this.revealSearchMessage();
      if (this.state.job) this.status.textContent = this.state.job.kind === 'compact' ? 'Creating a summary…' : 'Writing a reply…';
      else if (c.error) this.error(new Error(c.error));
      else if (['Writing a reply…', 'Creating a summary…'].includes(this.status.textContent)) this.status.textContent = c.preview ? 'Summary ready for review.' : 'Conversation saved.';
      this.renderButtons();
      this.onNavigation?.();
    }
    renderContext() {
      const c = this.current(); if (!c) return;
      const ids = c.contextIds || [];
      this.tokens.textContent = '';
      this.contextLabel.textContent = 'Context: ' + (c.summary ? 'summary + recent chat' : 'chat history') + (ids.length ? ' + chosen documents' : ' only');
      this.budgetView?.schedule();
    }
  }
  window.NeoChatView = NeoChatView;
})();
