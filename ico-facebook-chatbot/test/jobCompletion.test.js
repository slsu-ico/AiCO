const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { waitForJobs } = require('./support/jobCompletion');

test('integration completion wait ignores initial drained and unrelated jobs', async () => {
  const worker = new EventEmitter();
  let settled = false;
  const complete = waitForJobs(worker, ['choose', 'followup']).then(() => {
    settled = true;
  });
  worker.emit('drained');
  worker.emit('completed', { data: { id: 'other' } });
  worker.emit('completed', { data: { id: 'choose' } });
  await Promise.resolve();
  assert.equal(settled, false);
  worker.emit('completed', { data: { id: 'followup' } });
  await complete;
  assert.equal(settled, true);
});
