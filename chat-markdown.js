// Model text is untrusted. HTML stays literal; references never navigate or
// fetch resources. Only the parser's formatting markup reaches the chat DOM.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('markdown-it'));
  else root.ChatMarkdown = factory(root.markdownit);
})(typeof globalThis !== 'undefined' ? globalThis : this, MarkdownIt => {
  const parser = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false, maxNesting: 20 });
  const escape = parser.utils.escapeHtml;
  parser.renderer.rules.link_open = (tokens, index) => '<span class="ai-reference" title="' + escape(tokens[index].attrGet('href') || '') + '">';
  parser.renderer.rules.link_close = () => '</span>';
  parser.renderer.rules.image = (tokens, index) => escape(tokens[index].content || 'Image');
  return { render: text => parser.render(String(text ?? '')) };
});
