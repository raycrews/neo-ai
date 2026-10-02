const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { atomicJSON } = require('./protected-storage');
const Context = require('./chat-context');
const assistantTypes = require('./assistant-types');

const { history, attach, budget } = require('./chat-budget');
class ChatStore {
  constructor({ fileFor, connections, write = atomicJSON, changed = () => {}, resolveContext = async () => [], syncNavigation = null, instructionsFor = id => assistantTypes.find(type => type.id === id).instructions }) {
    this.fileFor = fileFor; this.connections = connections; this.write = write; this.changed = changed;
    this.resolveContext = resolveContext;
    this.syncNavigation = syncNavigation;
    this.instructionsFor = instructionsFor;
    this.cache = new Map(); this.jobs = new Map(); this.actions = new Map();
  }
  key(bookId) {
    if (typeof bookId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(bookId)) throw new Error('Invalid book.');
    return this.fileFor(bookId);
  }
  read(bookId) {
    const file = this.key(bookId);
    if (this.cache.has(file)) return this.cache.get(file);
    let data = { version: 1, selectedId: null, conversations: [] };
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read saved conversations. The file has been left unchanged.'); }
    if (data.version !== 1 || !Array.isArray(data.conversations) || data.conversations.some(c => !Array.isArray(c.messages) || typeof c.id !== 'string' || c.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')))
      throw new Error('Unrecognized conversation data. The file has been left unchanged.');
    // A interrupted process cannot resume a network request; keep its partial reply.
    for (const c of data.conversations) {
      c.assistantType ??= 'general';
      if (!assistantTypes.some(type => type.id === c.assistantType)) throw new Error('Unrecognized assistant type. The conversation file has been left unchanged.');
      try { c.contextIds = Context.selection(c.contextIds || []); }
      catch { throw new Error('Unrecognized context selection. The conversation file has been left unchanged.'); }
      for (const m of c.messages) if (m.status === 'streaming') m.status = 'stopped';
    }
    this.cache.set(file, data); return data;
  }
  state(bookId) {
    const job = this.jobs.get(this.key(bookId));
    return structuredClone({ ...this.read(bookId), job: job ? { kind: job.kind, conversationId: job.conversationId } : null });
  }
  notify(bookId) { this.changed(bookId, this.state(bookId)); }
  commit(bookId, data) {
    this.write(this.key(bookId), data);
    this.cache.set(this.key(bookId), data); this.notify(bookId);
  }
  async action(bookId, action) {
    const file = this.key(bookId);
    const operation = (this.actions.get(file) || Promise.resolve()).then(async () => {
      const state = action?.type === 'syncNavigation' ? this.state(bookId) : await this.perform(bookId, action);
      if (this.syncNavigation && ['new', 'rename', 'send', 'retry', 'resend', 'syncNavigation'].includes(action?.type)) {
        let linked;
        try { linked = await this.syncNavigation(bookId, this.state(bookId).conversations.map(c => ({ id: c.id, title: c.title, linked: !!c.navigationLinked, parentId: c.navigationParent || null }))); }
        catch (error) {
          // A reply is already running after Send; a navigation failure must
          // not present its saved user turn as an unsent draft for resubmission.
          if (!['send', 'retry', 'resend'].includes(action.type)) throw error;
          this.read(bookId).conversations.find(c => c.id === (['retry', 'resend'].includes(action.type) ? this.read(bookId).selectedId : action.id)).error = error.message;
          this.notify(bookId); return this.state(bookId);
        }
        const data = structuredClone(this.read(bookId)); let changed = false;
        for (const c of data.conversations) if (linked.includes(c.id) && !c.navigationLinked) { c.navigationLinked = true; delete c.navigationParent; changed = true; }
        if (changed) this.commit(bookId, data);
        return this.state(bookId);
      }
      return state;
    });
    const tail = operation.catch(() => {});
    this.actions.set(file, tail);
    tail.then(() => { if (this.actions.get(file) === tail) this.actions.delete(file); });
    return operation;
  }
  async perform(bookId, action) {
    if (!action || typeof action.type !== 'string') throw new Error('Invalid chat action.');
    const file = this.key(bookId);
    if (action.type === 'stop') { await this.stop(bookId); return this.state(bookId); }
    const data = structuredClone(this.read(bookId));
    let c = data.conversations.find(c => c.id === action.id);
    const job = this.jobs.get(file);
    if (job && !['draft', 'select'].includes(action.type)) throw new Error('Stop the current reply before changing the conversation.');
    const text = (value, max = 100000) => {
      if (typeof value !== 'string' || value.length > max) throw new Error('The text is missing or too long.'); return value;
    };
    if (['retry', 'resend'].includes(action.type)) {
      if (!c) throw new Error('That conversation no longer exists.');
      if (data.conversations.length >= 200) throw new Error('This book has reached the limit of 200 conversations.');
      const source = c, index = source.messages.findIndex(m => m.id === action.messageId);
      const promptIndex = action.type === 'retry' ? index - 1 : index;
      if (index < 0 || (action.type === 'retry' && source.messages[index].role !== 'assistant') || source.messages[promptIndex]?.role !== 'user')
        throw new Error('Choose a saved prompt or response.');
      const prompt = action.type === 'retry' ? source.messages[promptIndex].content : text(action.text).trim();
      if (!prompt) throw new Error('Write a message first.');
      const title = source.title.slice(0, 75) + (action.type === 'retry' ? ' · Retry' : ' · Revised');
      let name = title, count = 2;
      while (data.conversations.some(row => row.title === name)) name = title + ' (' + count++ + ')';
      c = { ...source, id: randomUUID(), title: name, draft: '', messages: source.messages.slice(0, promptIndex), preview: null,
        navigationLinked: false, branchFrom: { conversationId: source.id, messageId: action.messageId, kind: action.type } };
      delete c.error; delete c.navigationParent;
      // A summary reaching the revised turn could leak discarded later details.
      if (c.summary && !c.messages.some(m => m.id === c.summary.throughId)) c.summary = null;
      data.conversations.push(c); data.selectedId = c.id;
      action = { type: 'send', id: c.id, text: prompt };
    }
    if (action.type === 'new') {
      if (data.conversations.length >= 200) throw new Error('This book has reached the limit of 200 conversations.');
      const settings = this.connections.snapshot();
      const p = settings.profiles.find(p => p.id === settings.defaultId);
      c = { id: randomUUID(), title: 'New conversation', assistantType: 'general', profileId: p?.id || '', model: p?.model || '', draft: '', messages: [], summary: null, preview: null, contextIds: [] };
      if (action.title !== undefined) { c.title = text(action.title, 100).trim(); if (!c.title) throw new Error('Enter a conversation name.'); }
      if (action.parentId != null) c.navigationParent = text(action.parentId, 200);
      data.conversations.push(c); data.selectedId = c.id;
    } else {
      if (!c) throw new Error('That conversation no longer exists.');
      if (action.type === 'select') data.selectedId = c.id;
      else if (action.type === 'rename') { c.title = text(action.text, 100).trim(); if (!c.title) throw new Error('Enter a conversation name.'); }
      else if (action.type === 'draft') c.draft = text(action.text);
      else if (action.type === 'context') c.contextIds = Context.selection(action.ids);
      else if (action.type === 'assistant') {
        if (!assistantTypes.some(type => type.id === action.assistantType)) throw new Error('Choose a valid assistant type.');
        c.assistantType = action.assistantType;
      }
      else if (action.type === 'config') {
        if (!this.connections.snapshot().profiles.some(p => p.id === action.profileId)) throw new Error('Choose a saved connection.');
        c.profileId = action.profileId; c.model = text(action.model, 200).trim();
      } else if (action.type === 'applySummary') {
        if (!c.preview) throw new Error('Create a summary first.');
        const summary = text(action.text).trim(); if (!summary) throw new Error('Enter a summary before applying it.');
        c.summary = { text: summary, throughId: c.preview.throughId }; c.preview = null;
      } else if (action.type === 'previewEdit') {
        if (!c.preview || c.preview.status !== 'complete') throw new Error('Wait for the summary to finish.');
        c.preview.text = text(action.text);
      } else if (action.type === 'restore') { c.summary = null; c.preview = null; }
      else if (action.type === 'discardSummary') c.preview = null;
      else if (action.type === 'send' || action.type === 'compact') {
        delete c.error;
        if (!c.profileId || !c.model) throw new Error('Choose a connection and model first.');
        let messages, throughId, responseId;
        if (action.type === 'send') {
          const prompt = text(action.text).trim(); if (!prompt) throw new Error('Write a message first.');
          if (c.messages.length >= 10000) throw new Error('Start a new conversation. This conversation has reached its message limit.');
          // Resolve live sources in the trusted workspace on every send. Never
          // accept source text from an action or retain it in the chat history.
          const ids = Context.selection(c.contextIds || []);
          const context = Context.resolve(ids.length ? await this.resolveContext(bookId) : [], ids);
          c.messages.push({ id: randomUUID(), role: 'user', content: prompt, status: 'complete',
            ...(ids.length ? { contextSources: context.sources.map(({ id, path }) => ({ id, path })), contextOmitted: context.omitted.length } : {}) });
          c.draft = '';
          if (c.title === 'New conversation') c.title = prompt.replace(/\s+/g, ' ').slice(0, 60);
          messages = history(c, c.messages.length, this.instructionsFor(c.assistantType));
          // Put references in the latest user turn so local model templates
          // keep the same user/assistant order as an ordinary conversation.
          attach(messages, context.sources, prompt);
          responseId = randomUUID();
          c.messages.push({ id: responseId, role: 'assistant', content: '', status: 'streaming', profileId: c.profileId, model: c.model });
        } else {
          // Leave the last two exchanges verbatim. The old summary plus the
          // new older turns are compacted again, while originals stay on disk.
          const end = c.messages.length - 4;
          const previous = c.summary ? c.messages.findIndex(m => m.id === c.summary.throughId) : -1;
          if (end < 2 || end - 1 <= previous) throw new Error('More conversation is needed to compact. The last two exchanges stay in full.');
          throughId = c.messages[end - 1].id;
          messages = history(c, end);
          messages.push({ role: 'user', content: 'Summarize the preceding conversation for continuing our writing work. Preserve author decisions, confirmed facts, proposed ideas clearly marked as proposals, rejected ideas, constraints, open questions and next steps. Do not invent story facts. Be concise but keep specific names and details. Return only the summary.' });
          c.preview = null;
        }
        if (JSON.stringify(messages).length > 2 * 1024 * 1024) throw new Error('The conversation and context are too large to send. Choose fewer documents, compact the chat, or start a new conversation.');
        // Persist the user turn before any request leaves this computer.
        this.commit(bookId, data);
        this.start(bookId, c, { kind: action.type, messages, responseId, throughId });
        return this.state(bookId);
      } else throw new Error('Unknown chat action.');
    }
    this.commit(bookId, data); return this.state(bookId);
  }
  start(bookId, c, operation) {
    const file = this.key(bookId);
    const controller = new AbortController();
    const job = { ...operation, controller, conversationId: c.id, done: null };
    this.jobs.set(file, job);
    let lastCheckpoint = Date.now();
    const update = content => {
      const current = this.read(bookId).conversations.find(item => item.id === c.id);
      if (operation.kind === 'send') current.messages.find(m => m.id === operation.responseId).content = content;
      else current.preview = { text: content, throughId: operation.throughId, status: 'streaming' };
      if (Date.now() - lastCheckpoint > 1000) { this.write(file, this.read(bookId)); lastCheckpoint = Date.now(); }
      this.notify(bookId);
    };
    job.done = (async () => {
      let failure;
      try {
        await this.connections.generate({ profileId: c.profileId, model: c.model, messages: operation.messages, signal: controller.signal, onText: update, kind: operation.kind });
      } catch (error) { failure = error.code ? 'Could not save chat. Check disk space and file permissions.' : error.message; }
      const current = this.read(bookId).conversations.find(item => item.id === c.id);
      if (operation.kind === 'send') {
        const reply = current.messages.find(m => m.id === operation.responseId);
        reply.status = controller.signal.aborted ? 'stopped' : failure ? 'error' : 'complete';
        if (failure && !controller.signal.aborted) reply.error = failure;
      } else if (failure || controller.signal.aborted) { current.preview = null; current.error = failure || 'Compaction stopped.'; }
      else if (current.preview) current.preview.status = 'complete';
      this.jobs.delete(file);
      try { this.write(file, this.read(bookId)); }
      catch { current.error = 'Could not save chat. Keep this window open and try again.'; }
      this.notify(bookId);
    })();
    this.notify(bookId);
  }
  async inspect(bookId, id, draft, preview) {
    await this.actions.get(this.key(bookId));
    const c = structuredClone(this.read(bookId).conversations.find(c => c.id === id));
    if (!c) throw new Error('That conversation no longer exists.');
    for (const value of [draft, preview]) if (value !== undefined && (typeof value !== 'string' || value.length > 100000)) throw new Error('The text is missing or too long.');
    const ids = Context.selection(c.contextIds || []);
    const context = Context.resolve(ids.length ? await this.resolveContext(bookId) : [], ids);
    const instructions = this.instructionsFor(c.assistantType);
    const capacity = this.connections.contextCapacity?.(c.profileId, c.model) || { limit: null, source: 'unknown' };
    const reply = this.connections.responseSettings?.(c.profileId, c.model).maxReplyTokens;
    const current = budget(c, instructions, context, draft ?? c.draft, capacity.limit, reply);
    const proposed = c.preview?.status === 'complete' ? budget({ ...c, summary: { text: preview ?? c.preview.text, throughId: c.preview.throughId } }, instructions, context, draft ?? c.draft, capacity.limit, reply) : null;
    return { current, proposed, capacity };
  }
  async stop(bookId) {
    const job = this.jobs.get(this.key(bookId));
    if (job) { job.controller.abort(); await job.done; }
    // Retry a failed save before allowing a book/window to close.
    this.write(this.key(bookId), this.read(bookId));
  }
  async flush(bookId) { await this.actions.get(this.key(bookId)); await this.stop(bookId); }
}
module.exports = { ChatStore, history };
