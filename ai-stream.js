const { DEFAULT_REPLY_TOKENS } = require('./response-settings');
// Provider streaming stays in the main process. Server error bodies are never
// shown to a renderer, and credentials are redacted before emitting text.
async function generateText({ fetchImpl, profile, key, messages, model, signal, onText, timeoutMs = 300000, settings = {} }) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  let reader;
  let text = '', held = '', bytes = 0, terminal = false;
  function append(delta, final = false) {
    held += delta;
    if (key) held = held.split(key).join('[redacted]');
    // Hold a possible credential prefix across event boundaries.
    let keep = 0;
    if (key && !final) for (let n = 1; n < key.length && n <= held.length; n++) {
      if (held.endsWith(key.slice(0, n))) keep = n;
    }
    const visible = held.slice(0, held.length - keep);
    held = held.slice(held.length - keep);
    text += visible;
    if (text.length > 200000) throw new Error('The response exceeded the text limit.');
    if (visible) onText(text);
  }
  function event(data) {
    if (!data.trim() || terminal) return;
    if (data.trim() === '[DONE]') { terminal = true; return; }
    let value;
    try { value = JSON.parse(data); } catch { throw new Error('The server returned an invalid streaming event.'); }
    if (value.error || ['error', 'response.failed', 'response.incomplete'].includes(value.type))
      throw new Error('The provider could not finish the reply. Check its status and output allowance.');
    if (profile.api === 'responses') {
      if (value.type === 'response.output_text.delta' || value.type === 'response.refusal.delta') append(value.delta || '');
      if (value.type === 'response.completed') {
        if (!text && !held) append((value.response?.output || []).flatMap(o => o.content || []).map(c => c.text || c.refusal || '').join('\n'));
        terminal = true;
      }
    } else {
      const choice = value.choices?.[0];
      if (typeof choice?.delta?.content === 'string') append(choice.delta.content);
      if (choice?.finish_reason === 'length') throw new Error('The reply reached the output limit. Ask the model to continue.');
      if (choice?.finish_reason) terminal = true;
    }
  }
  try {
    const responses = profile.api === 'responses';
    const body = responses
      ? { model, input: messages, stream: true, store: false, max_output_tokens: settings.maxReplyTokens ?? DEFAULT_REPLY_TOKENS }
      : { model, messages, stream: true, max_tokens: settings.maxReplyTokens ?? DEFAULT_REPLY_TOKENS };
    if (settings.temperature != null) body.temperature = settings.temperature;
    const res = await fetchImpl(profile.baseUrl + (responses ? '/responses' : '/chat/completions'), {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      await res.body?.cancel();
      const hint = { 401: 'The server rejected the key.', 403: 'This key does not have access.', 404: 'Check the endpoint and model.', 429: 'The provider reported a rate or usage limit.' }[res.status];
      throw new Error(`HTTP ${res.status}. ${hint || 'The server could not complete the request.'}`);
    }
    if (!res.headers.get('content-type')?.includes('text/event-stream')) throw new Error('This endpoint did not return a text stream. Check the API format.');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', dataLines = [];
    function lines(final = false) {
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
        if (!line) { if (dataLines.length) event(dataLines.join('\n')); dataLines = []; }
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length + dataLines.join('').length > 256000) throw new Error('A streaming event was too large.');
      if (final && (buffer || dataLines.length)) throw new Error('The reply stream ended unexpectedly. Partial text has been kept.');
    }
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); lines(true); break; }
      bytes += value.length;
      if (bytes > 4 * 1024 * 1024) throw new Error('The response stream was too large.');
      buffer += decoder.decode(value, { stream: true }); lines();
    }
    if (!terminal) throw new Error('The reply stream ended unexpectedly. Partial text has been kept.');
    append('', true);
    if (!text.trim()) throw new Error('The model returned no text. Check that it supports text replies and has enough output allowance.');
    return text;
  } catch (error) {
    append('', true);
    if (controller.signal.aborted) throw new Error(timedOut ? 'The reply timed out. Partial text has been kept.' : 'Reply stopped.');
    if (error instanceof TypeError) throw new Error('Could not reach the server. Check its address and status. Redirects are not followed.');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
  }
}
module.exports = { generateText };
