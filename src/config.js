const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { loadManagedSecrets, shouldUseManagedSecrets } = require('./secretsManager');

function loadDotEnv(env) {
  const dotenvPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(dotenvPath)) return env;

  const values = { ...env };
  const lines = fs.readFileSync(dotenvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (values[key] === undefined) values[key] = value;
  }

  return values;
}

function compact(values) {
  return values.filter((value) => typeof value === 'string' && value.length > 0);
}

function isLoopbackServiceUrl(value) {
  if (!value) return false;

  let hostname;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }

  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'localhost.localdomain' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '127' ||
    normalized.startsWith('127.') ||
    /^::ffff:127\./.test(normalized) ||
    /^0:0:0:0:0:ffff:127\./.test(normalized)
  );
}

function hasAllowedRemoteServiceUrl(value, allowedProtocols) {
  try {
    const url = new URL(value);
    return allowedProtocols.has(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function getConfig(env = process.env, managedSecrets = {}) {
  const shouldLoadDotEnv = env === process.env && (env.NODE_ENV || 'development') !== 'production';
  const loadedEnv = {
    ...(shouldLoadDotEnv ? loadDotEnv(env) : env),
    ...managedSecrets,
  };
  const verifyTokens = compact([
    loadedEnv.MESSENGER_VERIFY_TOKEN_CURRENT || loadedEnv.MESSENGER_VERIFY_TOKEN,
    loadedEnv.MESSENGER_VERIFY_TOKEN_PREVIOUS,
  ]);
  const sessionSecrets = compact([
    loadedEnv.SESSION_SECRET_CURRENT || loadedEnv.SESSION_SECRET,
    loadedEnv.SESSION_SECRET_PREVIOUS,
  ]);

  return {
    port: Number(loadedEnv.PORT || 3000),
    verifyToken: verifyTokens[0] || 'dev-verify-token',
    ...(verifyTokens.length > 1 ? { verifyTokens } : {}),
    messengerAppSecret: loadedEnv.MESSENGER_APP_SECRET || '',
    pageAccessToken: loadedEnv.PAGE_ACCESS_TOKEN || '',
    databaseUrl: loadedEnv.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: loadedEnv.REDIS_URL || 'redis://localhost:6379',
    uploadDir: loadedEnv.UPLOAD_DIR || 'uploads',
    sessionSecret: sessionSecrets[0] || 'dev-session-secret-change-me',
    ...(sessionSecrets.length > 1 ? { sessionSecrets } : {}),
    ...(loadedEnv.RUNTIME_CONFIG_VERSION
      ? { runtimeConfigVersion: loadedEnv.RUNTIME_CONFIG_VERSION }
      : {}),
    webhookMaxBodyBytes: Number(loadedEnv.WEBHOOK_MAX_BODY_BYTES || 1024 * 1024),
    messengerEventDedupTtlSeconds: Number(
      loadedEnv.MESSENGER_EVENT_DEDUP_TTL_SECONDS || 24 * 60 * 60,
    ),
    bootstrapAdminEmail: loadedEnv.BOOTSTRAP_ADMIN_EMAIL || 'admin@slsu.edu.ph',
    bootstrapAdminPassword: loadedEnv.BOOTSTRAP_ADMIN_PASSWORD || '',
  };
}

async function getRuntimeConfig(env = process.env, options = {}) {
  const managedSecrets = shouldUseManagedSecrets(env)
    ? await loadManagedSecrets({
        env,
        fetchImpl: options.fetchImpl,
        oidcToken: options.vercelOidcToken,
      })
    : {};
  return getConfig(env, managedSecrets);
}

function validateConfig(config, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== 'production') return;

  const missing = [];
  if (!config.databaseUrl) {
    missing.push('DATABASE_URL');
  }
  if (!config.redisUrl) {
    missing.push('REDIS_URL');
  }
  if (!config.pageAccessToken) {
    missing.push('PAGE_ACCESS_TOKEN');
  }
  if (!config.messengerAppSecret) {
    missing.push('MESSENGER_APP_SECRET');
  }
  if (!config.verifyToken || config.verifyToken === 'dev-verify-token') {
    missing.push('MESSENGER_VERIFY_TOKEN');
  }
  if (!config.sessionSecret || config.sessionSecret === 'dev-session-secret-change-me') {
    missing.push('SESSION_SECRET');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables for production: ${missing.join(', ')}`);
  }

  const invalidServiceUrls = [];
  if (!hasAllowedRemoteServiceUrl(config.databaseUrl, new Set(['postgres:', 'postgresql:']))) {
    invalidServiceUrls.push('DATABASE_URL');
  }
  if (!hasAllowedRemoteServiceUrl(config.redisUrl, new Set(['redis:', 'rediss:']))) {
    invalidServiceUrls.push('REDIS_URL');
  }
  if (invalidServiceUrls.length) {
    throw new Error(
      `Production service URLs use an unsupported scheme or omit a remote host: ${invalidServiceUrls.join(', ')}`,
    );
  }

  const localServiceUrls = [];
  if (isLoopbackServiceUrl(config.databaseUrl)) {
    localServiceUrls.push('DATABASE_URL');
  }
  if (isLoopbackServiceUrl(config.redisUrl)) {
    localServiceUrls.push('REDIS_URL');
  }

  if (localServiceUrls.length) {
    throw new Error(
      `Production service URLs must not use localhost or loopback addresses: ${localServiceUrls.join(', ')}`,
    );
  }
}

module.exports = {
  getConfig,
  getRuntimeConfig,
  hasAllowedRemoteServiceUrl,
  isLoopbackServiceUrl,
  validateConfig,
};
