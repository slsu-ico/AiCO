const assert = require('node:assert/strict');
const test = require('node:test');

const { getConfig } = require('../src/config');

test('returns runtime configuration defaults', () => {
  assert.deepEqual(getConfig({}), {
    port: 3000,
    verifyToken: 'dev-verify-token',
    pageAccessToken: '',
    databaseUrl: 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: 'redis://localhost:6379',
    uploadDir: 'uploads',
    sessionSecret: 'dev-session-secret-change-me',
    bootstrapAdminEmail: 'admin@slsu.edu.ph',
    bootstrapAdminPassword: '',
  });
});

test('returns runtime configuration from environment overrides', () => {
  const config = getConfig({
    PORT: '8080',
    MESSENGER_VERIFY_TOKEN: 'verify-token',
    PAGE_ACCESS_TOKEN: 'page-token',
    DATABASE_URL: 'postgres://user:pass@db.example:5432/prod',
    REDIS_URL: 'redis://redis.example:6379',
    UPLOAD_DIR: 'custom-uploads',
    SESSION_SECRET: 'session-secret',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.edu',
    BOOTSTRAP_ADMIN_PASSWORD: 'SuperSecret123!',
  });

  assert.deepEqual(config, {
    port: 8080,
    verifyToken: 'verify-token',
    pageAccessToken: 'page-token',
    databaseUrl: 'postgres://user:pass@db.example:5432/prod',
    redisUrl: 'redis://redis.example:6379',
    uploadDir: 'custom-uploads',
    sessionSecret: 'session-secret',
    bootstrapAdminEmail: 'admin@example.edu',
    bootstrapAdminPassword: 'SuperSecret123!',
  });
});
