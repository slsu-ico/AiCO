const test = require('node:test');
const assert = require('node:assert/strict');
const { createSender, splitReplies } = require('../src/messenger');
const { getConfig } = require('../src/config');

const env = {
  ICO_PAGE_ID: '123456789',
  PAGE_ACCESS_TOKEN: 'page-token-for-tests-only',
  MESSENGER_APP_SECRET: 'app-secret-for-tests-only',
  MESSENGER_VERIFY_TOKEN: 'verify-token-for-tests-only',
  META_GRAPH_VERSION: 'v24.0',
  REDIS_URL: 'redis://localhost:6379',
};
const config = getConfig(env);

test('configuration requires explicit Page, secrets, Redis and Graph version', () => {
  for (const key of Object.keys(env)) {
    assert.throws(() => getConfig({ ...env, [key]: '' }), /required|invalid/i);
  }
  assert.throws(() => getConfig({ ...env, ICO_PAGE_ID: 'me' }), /invalid/i);
  assert.throws(() => getConfig({ ...env, REDIS_URL: 'https://redis.example' }), /invalid/i);
});

test('legacy AI variables cannot enable an external provider or affect startup configuration', () => {
  const config = getConfig({
    ...env,
    AI_GATEWAY_API_KEY: 'unused-key',
    AI_GATEWAY_BASE_URL: 'http://unused.invalid',
    AI_MODEL: 'unused-model',
  });
  assert.equal(config.pageId, '123456789');
  assert.equal(config.aiKey, undefined);
  assert.equal(config.aiBaseUrl, undefined);
  assert.equal(config.aiModel, undefined);
});

test('Messenger chunks preserve Unicode and put quick replies only on final chunk', () => {
  const original = 'Hello ' + '😀'.repeat(1300);
  const chunks = splitReplies([
    { text: original, quickReplies: [{ title: 'Services', payload: 'MENU' }] },
  ]);
  assert.equal(chunks.map((c) => c.text).join(''), original);
  assert.ok(
    chunks.every((c) => c.text.length <= 1800 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(c.text)),
  );
  assert.equal(chunks[0].quickReplies, undefined);
  assert.equal(chunks.at(-1).quickReplies[0].payload, 'MENU');
});

test('Messenger sends only to configured Page endpoint and bounds quick replies', async () => {
  let captured;
  const send = createSender(config, {
    fetchImpl: async (url, options) => {
      captured = { url, ...options };
      return globalThis.Response.json({ recipient_id: '456', message_id: 'm_1' });
    },
  });
  await send('456', {
    text: 'Choose a service',
    quickReplies: [{ title: 'x'.repeat(30), payload: 'MENU' }],
  });
  assert.equal(captured.url, 'https://graph.facebook.com/v24.0/123456789/messages');
  const body = JSON.parse(captured.body);
  assert.equal(body.recipient.id, '456');
  assert.equal(body.messaging_type, 'RESPONSE');
  assert.equal(body.message.quick_replies[0].title.length, 20);
  await assert.rejects(send('not-a-psid', { text: 'message' }), /recipient/i);
});

test('Messenger errors do not expose upstream bodies or access tokens', async () => {
  const send = createSender(config, {
    fetchImpl: async () => new globalThis.Response('private-page-token', { status: 403 }),
  });
  await assert.rejects(
    send('456', { text: 'text' }),
    (error) => error.message === 'Messenger request failed (403).',
  );
});
