const assert = require('node:assert/strict');
const test = require('node:test');

const {
  renderAdminDashboard,
  renderChatbotDemo,
  renderChatbotDemoScript,
  renderLogin,
  renderNewContentForm,
} = require('../src/adminViews');

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

test('admin dashboard renders compact metric tiles with existing actions', () => {
  const html = renderAdminDashboard(
    { role: 'admin', name: 'Bootstrap Admin', csrfToken: 'csrf-token' },
    {
      pending_account_requests: 3,
      pending_content_reviews: 4,
      published_records: 9,
    },
  );

  assert.match(html, /class="metric-grid"/);
  assert.match(html, /Pending account requests/);
  assert.match(html, /href="\/admin\/account-requests"/);
  assert.match(html, /Pending content reviews/);
  assert.match(html, /href="\/admin\/reviews"/);
  assert.match(html, /Published records/);
  assert.match(html, /action="\/admin\/cache\/refresh"/);
  assert.match(html, /value="csrf-token"/);
});

test('chatbot demo renders static simulator shell safely', () => {
  const html = renderChatbotDemo({
    role: 'admin',
    name: '<script>alert(1)</script>',
  });

  assert.match(html, /AiCO chatbot demo/);
  assert.match(html, /class="chat-demo-shell"/);
  assert.match(html, /id="chat-demo-messages"/);
  assert.match(html, /id="chat-demo-form"/);
  assert.match(html, /src="\/admin\/chatbot-demo\.js"/);
  assert.match(html, /Southern Luzon State University/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('chatbot demo script seeds local quick replies', () => {
  const script = renderChatbotDemoScript();

  assert.match(script, /Request AVP production/);
  assert.match(script, /chat-demo-messages/);
  assert.match(script, /addEventListener\('submit'/);
});
