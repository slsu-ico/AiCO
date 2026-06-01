const fs = require('node:fs');
const path = require('node:path');

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

function getConfig(env = process.env) {
  const shouldLoadDotEnv = env === process.env && (env.NODE_ENV || 'development') !== 'production';
  const loadedEnv = shouldLoadDotEnv ? loadDotEnv(env) : env;
  return {
    port: Number(loadedEnv.PORT || 3000),
    verifyToken: loadedEnv.MESSENGER_VERIFY_TOKEN || 'dev-verify-token',
    pageAccessToken: loadedEnv.PAGE_ACCESS_TOKEN || '',
    databaseUrl: loadedEnv.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: loadedEnv.REDIS_URL || 'redis://localhost:6379',
    uploadDir: loadedEnv.UPLOAD_DIR || 'uploads',
    sessionSecret: loadedEnv.SESSION_SECRET || 'dev-session-secret-change-me',
    bootstrapAdminEmail: loadedEnv.BOOTSTRAP_ADMIN_EMAIL || 'admin@slsu.edu.ph',
    bootstrapAdminPassword: loadedEnv.BOOTSTRAP_ADMIN_PASSWORD || '',
  };
}

module.exports = {
  getConfig,
};
