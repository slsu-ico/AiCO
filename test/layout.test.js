const assert = require('node:assert/strict');
const test = require('node:test');

const { pageLayout } = require('../src/layout');

test('page layout declares Philippine English and keeps the skip link mobile-accessible', () => {
  const html = pageLayout({ title: 'Sign in', body: '<p>Welcome</p>' });

  assert.match(html, /<html lang="en-PH">/);
  assert.match(html, /<a class="skip-link" href="#main-content">Skip to main content<\/a>/);
  assert.match(html, /<main class="content" id="main-content" tabindex="-1">/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.skip-link:focus/);
});

test('page layout renders grouped admin shell navigation', () => {
  const html = pageLayout({
    title: 'Admin dashboard',
    body: '<p>Welcome</p>',
    activePath: '/admin/chatbot-demo',
    user: { role: 'admin', name: 'Bootstrap Admin' },
  });

  assert.match(html, /class="nav-group-label"/);
  assert.match(html, /href="\/admin\/chatbot-demo"/);
  assert.match(html, /aria-current="page" href="\/admin\/chatbot-demo"/);
  assert.match(html, /class="sidebar-user-avatar"/);
});
