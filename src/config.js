const fs = require('node:fs');
const path = require('node:path');

const {
  loadManagedSecrets,
  shouldUseManagedSecrets,
} = require('./secretsManager');

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
    pageAccessToken: loadedEnv.PAGE_ACCESS_TOKEN || '',
    databaseUrl: loadedEnv.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: loadedEnv.REDIS_URL || 'redis://localhost:6379',
    uploadDir: loadedEnv.UPLOAD_DIR || 'uploads',
    sessionSecret: sessionSecrets[0] || 'dev-session-secret-change-me',
    ...(sessionSecrets.length > 1 ? { sessionSecrets } : {}),
    bootstrapAdminEmail: loadedEnv.BOOTSTRAP_ADMIN_EMAIL || 'admin@slsu.edu.ph',
    bootstrapAdminPassword: loadedEnv.BOOTSTRAP_ADMIN_PASSWORD || '',
  };
}

async function getRuntimeConfig(env = process.env, options = {}) {
  const managedSecrets = shouldUseManagedSecrets(env)
    ? await loadManagedSecrets({ env, fetchImpl: options.fetchImpl })
    : {};
  return getConfig(env, managedSecrets);
}

function validateConfig(config) {
  if (process.env.NODE_ENV !== 'production') return;

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
  if (!config.verifyToken || config.verifyToken === 'dev-verify-token') {
    missing.push('MESSENGER_VERIFY_TOKEN');
  }
  if (!config.sessionSecret || config.sessionSecret === 'dev-session-secret-change-me') {
    missing.push('SESSION_SECRET');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables for production: ${missing.join(', ')}`);
  }
}

module.exports = {
  getConfig,
  getRuntimeConfig,
  validateConfig,
};
