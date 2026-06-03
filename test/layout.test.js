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
