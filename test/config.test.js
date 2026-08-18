const assert = require('node:assert/strict');
const test = require('node:test');

const { getConfig, validateConfig } = require('../src/config');

function productionConfig(overrides = {}) {
  return {
    databaseUrl: 'postgres://user:pass@db.example:5432/prod',
    redisUrl: 'rediss://redis.example:6380',
    pageAccessToken: 'page-token',
    messengerAppSecret: 'app-secret',
    verifyToken: 'verify-token',
    sessionSecret: 'session-secret',
    ...overrides,
  };
}

test('returns runtime configuration defaults', () => {
  assert.deepEqual(getConfig({}), {
    port: 3000,
    verifyToken: 'dev-verify-token',
    messengerAppSecret: '',
    pageAccessToken: '',
    databaseUrl: 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: 'redis://localhost:6379',
    uploadDir: 'uploads',
    sessionSecret: 'dev-session-secret-change-me',
    webhookMaxBodyBytes: 1024 * 1024,
    messengerEventDedupTtlSeconds: 24 * 60 * 60,
    bootstrapAdminEmail: 'admin@slsu.edu.ph',
    bootstrapAdminPassword: '',
  });
});

test('returns runtime configuration from environment overrides', () => {
  const config = getConfig({
    PORT: '8080',
    MESSENGER_VERIFY_TOKEN: 'verify-token',
    MESSENGER_APP_SECRET: 'app-secret',
    PAGE_ACCESS_TOKEN: 'page-token',
    DATABASE_URL: 'postgres://user:pass@db.example:5432/prod',
    REDIS_URL: 'redis://redis.example:6379',
    UPLOAD_DIR: 'custom-uploads',
    SESSION_SECRET: 'session-secret',
    RUNTIME_CONFIG_VERSION: 'runtime-version-2',
    WEBHOOK_MAX_BODY_BYTES: '2048',
    MESSENGER_EVENT_DEDUP_TTL_SECONDS: '3600',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.edu',
    BOOTSTRAP_ADMIN_PASSWORD: 'SuperSecret123!',
  });

  assert.deepEqual(config, {
    port: 8080,
    verifyToken: 'verify-token',
    messengerAppSecret: 'app-secret',
    pageAccessToken: 'page-token',
    databaseUrl: 'postgres://user:pass@db.example:5432/prod',
    redisUrl: 'redis://redis.example:6379',
    uploadDir: 'custom-uploads',
    sessionSecret: 'session-secret',
    runtimeConfigVersion: 'runtime-version-2',
    webhookMaxBodyBytes: 2048,
    messengerEventDedupTtlSeconds: 3600,
    bootstrapAdminEmail: 'admin@example.edu',
    bootstrapAdminPassword: 'SuperSecret123!',
  });
});

test('maps managed secret values into runtime configuration', () => {
  const config = getConfig(
    {
      PORT: '8080',
      UPLOAD_DIR: 'custom-uploads',
    },
    {
      MESSENGER_VERIFY_TOKEN_CURRENT: 'verify-current',
      MESSENGER_VERIFY_TOKEN_PREVIOUS: 'verify-previous',
      MESSENGER_APP_SECRET: 'app-secret',
      PAGE_ACCESS_TOKEN: 'page-token',
      DATABASE_URL: 'postgres://user:pass@db.example:5432/prod',
      REDIS_URL: 'redis://redis.example:6379',
      SESSION_SECRET_CURRENT: 'session-current',
      SESSION_SECRET_PREVIOUS: 'session-previous',
      RUNTIME_CONFIG_VERSION: 'runtime-version-2',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.edu',
      BOOTSTRAP_ADMIN_PASSWORD: 'SuperSecret123!',
    },
  );

  assert.deepEqual(config, {
    port: 8080,
    verifyToken: 'verify-current',
    verifyTokens: ['verify-current', 'verify-previous'],
    messengerAppSecret: 'app-secret',
    pageAccessToken: 'page-token',
    databaseUrl: 'postgres://user:pass@db.example:5432/prod',
    redisUrl: 'redis://redis.example:6379',
    uploadDir: 'custom-uploads',
    sessionSecret: 'session-current',
    sessionSecrets: ['session-current', 'session-previous'],
    runtimeConfigVersion: 'runtime-version-2',
    webhookMaxBodyBytes: 1024 * 1024,
    messengerEventDedupTtlSeconds: 24 * 60 * 60,
    bootstrapAdminEmail: 'admin@example.edu',
    bootstrapAdminPassword: 'SuperSecret123!',
  });
});

test('requires the Meta app secret in production', () => {
  assert.throws(
    () => validateConfig(productionConfig({ messengerAppSecret: '' }), 'production'),
    /MESSENGER_APP_SECRET/,
  );
});

test('rejects a localhost production database URL', () => {
  assert.throws(
    () =>
      validateConfig(
        productionConfig({ databaseUrl: 'postgres://user:pass@localhost:5432/aico' }),
        'production',
      ),
    /DATABASE_URL/,
  );
});

test('rejects a loopback production Redis URL', () => {
  assert.throws(
    () => validateConfig(productionConfig({ redisUrl: 'rediss://[::1]:6380' }), 'production'),
    /REDIS_URL/,
  );
});

test('rejects in-process Redis and unsupported production database URLs', () => {
  assert.throws(
    () => validateConfig(productionConfig({ redisUrl: 'memory://' }), 'production'),
    /REDIS_URL/,
  );
  assert.throws(
    () =>
      validateConfig(productionConfig({ databaseUrl: 'https://db.example/prod' }), 'production'),
    /DATABASE_URL/,
  );
});
