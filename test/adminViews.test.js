const assert = require('node:assert/strict');
const test = require('node:test');

const { renderLogin, renderNewContentForm } = require('../src/adminViews');

test('admin view module escapes notice text rendered by public forms', () => {
  const html = renderLogin({ notice: '<script>alert(1)</script>' });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('admin view module renders office content form with escaped user metadata', () => {
  const html = renderNewContentForm({
    user: {
      office_id: '7"><script>alert(1)</script>',
      csrfToken: 'token"><script>alert(2)</script>',
    },
  });

  assert.match(html, /value="7&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /value="token&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;"/);
  assert.doesNotMatch(html, /<script>alert/);
});
