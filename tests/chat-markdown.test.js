const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../chat-markdown');
const { exportConversation } = require('../chat-export');
test('chat Markdown formats headings, emphasis, nested lists, quotes, breaks and literal code', () => {
  const html = render('### Established Facts\n\n**Sarah** has an *uncertain* past.\nAnother line.\n\n1. Motivation\n   - A detail\n   - Another detail\n2. Goal\n\n> A quote\n\n---\n\n`**literal**`\n\n```html\n<script>alert(1)</script>\n```');
  for (const expected of ['<h3>Established Facts</h3>', '<strong>Sarah</strong>', '<em>uncertain</em>', '<br>', '<ol>', '<ul>', '<blockquote>', '<hr>', '<code>**literal**</code>', '&lt;script&gt;alert(1)&lt;/script&gt;']) assert.ok(html.includes(expected), expected);
  assert.ok(!html.includes('<script>'));
  assert.match(render('7. Seven\n8. Eight'), /<ol start="7">/);
});
test('untrusted HTML, images and links cannot execute code, navigate or load remote content', () => {
  const attacks = [
    '<script>globalThis.pwned=true</script>', '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>', '<iframe src="https://example.com"></iframe>',
    '[click](javascript:alert%281%29)', '[click](data:text/html,evil)',
    '[file](file:///C:/secret)', '[web](https://example.com)', '<https://example.com>',
    '![image](https://example.com/tracker.png)', '![<img src=x onerror=alert(1)>](x)',
    '[title](https://example.com/\" onmouseover=\"evil)',
    '```\" onmouseover=\"evil\ncode\n```', '&lt;script&gt;alert(1)&lt;/script&gt;'
  ];
  for (const source of attacks) {
    const html = render(source);
    assert.doesNotMatch(html, /<(?:script|img|svg|iframe|a|object|embed|style)\b/i, source);
    assert.doesNotMatch(html, /<[^>]+\s(?:on\w+|src|href)\s*=/i, source);
  }
});
test('incomplete streamed Markdown tolerates each prefix; export preserves original source', () => {
  const source = '## Ideas\n\n1. **Sarah** considers *why*.\n   - A detail\n\n```text\n<literal>\n```';
  for (let end = 0; end <= source.length; end++) assert.equal(typeof render(source.slice(0, end)), 'string');
  assert.match(render('An **unfinished'), /unfinished/);
  const exported = exportConversation({ title: 'Test', messages: [{ role: 'assistant', content: source }] });
  assert.ok(exported.text.includes(source));
});
