// Export the original transcript, including turns replaced by a context summary.
// Notes documents store literal text so model output cannot become executable HTML.
function exportConversation(conversation) {
  if (!conversation || !conversation.messages?.length) throw new Error('There are no messages to export yet.');
  const title = conversation.title || 'Chat conversation';
  const turns = conversation.messages.map(message => {
    const label = message.role === 'user' ? 'You' : 'Assistant' + (message.model ? ' (' + message.model + ')' : '');
    const status = message.status === 'stopped' ? '[Reply stopped]' : message.status === 'error' ? '[Reply failed]' : '';
    return [label, message.content || '[No text received]', status, message.error || ''].filter(Boolean).join('\n\n');
  });
  return { title, text: ['Conversation: ' + title, ...turns].join('\n\n---\n\n') };
}
module.exports = { exportConversation };
