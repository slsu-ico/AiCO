const assert = require('node:assert/strict');
const test = require('node:test');

const {
  likePattern,
  listStateFromUrl,
  noticeText,
  totalFromRows,
} = require('../src/adminListState');

test('listStateFromUrl normalizes paging, filters, and base path', () => {
  const state = listStateFromUrl(
    new URL('http://localhost/admin/reviews?page=-2&q= FAQ &type=faq'),
    {
      basePath: '/admin/reviews',
    },
  );

  assert.deepEqual(state, {
    page: 1,
    q: 'FAQ',
    status: '',
    type: 'faq',
    notice: '',
    basePath: '/admin/reviews',
  });
});

test('list helpers preserve query patterns and safe totals', () => {
  assert.equal(likePattern('Scholarship'), '%Scholarship%');
  assert.equal(totalFromRows([{ total_count: '41' }]), 41);
  assert.equal(totalFromRows([]), 0);
  assert.equal(noticeText('approved', { approved: 'Approved.' }), 'Approved.');
  assert.equal(noticeText('unknown', { approved: 'Approved.' }), '');
});
