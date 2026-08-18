const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFinalizePayload,
  buildRotationPayload,
  generateManagedSecret,
  verifyHealth,
} = require('../scripts/rotate-managed-secrets');

test('generateManagedSecret creates url-safe high entropy values', () => {
  const secret = generateManagedSecret();

  assert.equal(typeof secret, 'string');
  assert(secret.length >= 43);
  assert.match(secret, /^[A-Za-z0-9_-]+$/);
});

test('buildRotationPayload keeps old keys active while promoting new keys', () => {
  const payload = buildRotationPayload(
    {
      MESSENGER_VERIFY_TOKEN_CURRENT: 'verify-old',
      SESSION_SECRET_CURRENT: 'session-old',
      PAGE_ACCESS_TOKEN: 'page-token',
      DATABASE_URL: 'postgres://db',
      REDIS_URL: 'redis://cache',
    },
    {
      now: new Date('2026-06-04T00:00:00.000Z'),
      transitionMinutes: 60,
      nextMessengerVerifyToken: 'verify-new',
      nextSessionSecret: 'session-new',
      nextRuntimeConfigVersion: 'runtime-version-2',
    },
  );

  assert.equal(payload.MESSENGER_VERIFY_TOKEN_CURRENT, 'verify-new');
  assert.equal(payload.MESSENGER_VERIFY_TOKEN_PREVIOUS, 'verify-old');
  assert.equal(payload.SESSION_SECRET_CURRENT, 'session-new');
  assert.equal(payload.SESSION_SECRET_PREVIOUS, 'session-old');
  assert.equal(payload.RUNTIME_CONFIG_VERSION, 'runtime-version-2');
  assert.equal(payload.SECRET_ROTATION_STARTED_AT, '2026-06-04T00:00:00.000Z');
  assert.equal(payload.SECRET_ROTATION_REVOKE_AFTER, '2026-06-04T01:00:00.000Z');
  assert.equal(payload.PAGE_ACCESS_TOKEN, 'page-token');
});

test('buildFinalizePayload refuses to revoke old keys before transition window ends', () => {
  assert.throws(
    () =>
      buildFinalizePayload(
        {
          MESSENGER_VERIFY_TOKEN_CURRENT: 'verify-new',
          MESSENGER_VERIFY_TOKEN_PREVIOUS: 'verify-old',
          SESSION_SECRET_CURRENT: 'session-new',
          SESSION_SECRET_PREVIOUS: 'session-old',
          SECRET_ROTATION_REVOKE_AFTER: '2026-06-04T01:00:00.000Z',
        },
        { now: new Date('2026-06-04T00:30:00.000Z') },
      ),
    /transition window has not ended/i,
  );
});

test('buildFinalizePayload revokes old keys after transition window ends', () => {
  const payload = buildFinalizePayload(
    {
      MESSENGER_VERIFY_TOKEN_CURRENT: 'verify-new',
      MESSENGER_VERIFY_TOKEN_PREVIOUS: 'verify-old',
      SESSION_SECRET_CURRENT: 'session-new',
      SESSION_SECRET_PREVIOUS: 'session-old',
      SECRET_ROTATION_REVOKE_AFTER: '2026-06-04T01:00:00.000Z',
    },
    {
      now: new Date('2026-06-04T01:01:00.000Z'),
      nextRuntimeConfigVersion: 'runtime-version-3',
    },
  );

  assert.equal(payload.MESSENGER_VERIFY_TOKEN_CURRENT, 'verify-new');
  assert.equal(payload.MESSENGER_VERIFY_TOKEN_PREVIOUS, '');
  assert.equal(payload.SESSION_SECRET_CURRENT, 'session-new');
  assert.equal(payload.SESSION_SECRET_PREVIOUS, '');
  assert.equal(payload.RUNTIME_CONFIG_VERSION, 'runtime-version-3');
  assert.equal(payload.SECRET_ROTATION_FINALIZED_AT, '2026-06-04T01:01:00.000Z');
});

test('verifyHealth waits for the newly deployed runtime configuration marker', async () => {
  const versions = ['old-runtime', 'new-runtime'];
  let calls = 0;

  await verifyHealth(
    {
      ROTATION_HEALTH_URL: 'https://app.example.test/health',
      RUNTIME_CONFIG_VERSION: 'new-runtime',
    },
    {
      timeoutMs: 1000,
      sleep: async () => {},
      async fetchImpl() {
        const runtimeConfigVersion = versions[Math.min(calls, versions.length - 1)];
        calls += 1;
        return {
          ok: true,
          async json() {
            return { status: 'ok', runtimeConfigVersion };
          },
        };
      },
    },
  );

  assert.equal(calls, 2);
});
