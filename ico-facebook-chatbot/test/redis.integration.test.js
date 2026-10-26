const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { waitForJobs } = require('./support/jobCompletion');
const { createQueueResources, start } = require('../src/runtime');
const { getConfig } = require('../src/config');
const redisUrl = process.env.TEST_REDIS_URL;
const config = {
  ...getConfig({
    ICO_PAGE_ID: '123456789',
    PAGE_ACCESS_TOKEN: 'test-page-token-only',
    MESSENGER_APP_SECRET: 'test-app-secret-only',
    MESSENGER_VERIFY_TOKEN: 'test-verify-token-only',
    META_GRAPH_VERSION: 'v24.0',
    REDIS_URL: redisUrl || 'redis://localhost:6379',
  }),
  namespace: 'ico-test-' + randomUUID(),
  port: 0,
};

test(
  'real Redis deduplicates concurrent enqueueing and persists expiring sessions',
  { skip: !redisUrl, timeout: 15000 },
  async () => {
    const resources = await createQueueResources(config);
    try {
      const event = {
        id: 'unique-message',
        senderId: '987654321',
        message: 'hello',
        timestamp: Date.now(),
      };
      await Promise.all([resources.enqueue([event]), resources.enqueue([event])]);
      assert.equal(await resources.queue.getWaitingCount(), 1);
      await resources.saveSession('987654321', {
        lastServiceId: 'internal-writing-request',
        locale: 'en',
      });
      assert.equal(
        (await resources.getSession('987654321')).lastServiceId,
        'internal-writing-request',
      );
      assert.ok((await resources.redis.ttl(`${config.namespace}:session:987654321`)) > 0);
      assert.equal(await resources.queue.getGlobalConcurrency(), 1);
    } finally {
      await resources.queue.obliterate({ force: true });
      await resources.close();
    }
  },
);

test(
  'real runtime health and worker preserve follow-up order through a transient send failure',
  { skip: !redisUrl, timeout: 20000 },
  async () => {
    const seen = [];
    let firstFailure = true;
    const runtime = await start(
      { ...config, namespace: config.namespace + '-runtime' },
      {
        send: async (_id, reply) => {
          if (firstFailure) {
            firstFailure = false;
            throw new Error('transient send failure');
          }
          seen.push(reply.text);
        },
      },
    );
    try {
      const health = await fetch(`http://127.0.0.1:${runtime.server.address().port}/health`);
      assert.equal(health.status, 200);
      const completions = waitForJobs(runtime.worker, ['choose', 'followup']);
      await runtime.enqueue([
        {
          id: 'choose',
          senderId: '987654321',
          message: 'SERVICE_internal-writing-request',
          timestamp: Date.now(),
        },
        {
          id: 'followup',
          senderId: '987654321',
          message: 'Where is the form?',
          timestamp: Date.now(),
        },
      ]);
      await completions;
      assert.equal(seen.length, 2);
      assert.match(seen[0], /Requirements:/);
      assert.doesNotMatch(seen[1], /Requirements:/);
      assert.match(seen[1], /forms.gle\/CsJsfxNxSFt4Swo38/);
      await runtime.worker.close();
      await runtime.queue.obliterate({ force: true });
    } finally {
      await runtime.close();
    }
  },
);
