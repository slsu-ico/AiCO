const crypto = require('node:crypto');

const { deleteKey, getJson, setJson } = require('./cache/redis');
const { hashPassword, verifyPassword } = require('./passwordHash');

const AICO_SESSION_COOKIE = 'aico_session';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

function shouldUseSecureCookie(options = {}) {
  return options.secure ?? process.env.NODE_ENV === 'production';
}

function withSecureAttribute(cookie, options = {}) {
  return shouldUseSecureCookie(options) ? `${cookie}; Secure` : cookie;
}

function sessionCookie(sessionId, ttlSeconds = DEFAULT_SESSION_TTL_SECONDS, options = {}) {
  return withSecureAttribute(
    `${AICO_SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`,
    options,
  );
}

function clearSessionCookie(options = {}) {
  return withSecureAttribute(
    `${AICO_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    options,
  );
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};

  return cookieHeader.split(';').reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) return cookies;

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = decodeCookieValue(value);
    return cookies;
  }, {});
}

function configuredSessionSecrets(options = {}) {
  const values = options.sessionSecrets || [options.sessionSecret];
  return values.filter((value) => typeof value === 'string' && value.length > 0);
}

function signSessionId(sessionId, secret) {
  return crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function signaturesMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function signedSessionValue(sessionId, secret) {
  return secret ? `${sessionId}.${signSessionId(sessionId, secret)}` : sessionId;
}

function getSessionId(cookieHeader, options = {}) {
  const cookieValue = parseCookies(cookieHeader)[AICO_SESSION_COOKIE];
  if (!cookieValue) return null;

  const secrets = configuredSessionSecrets(options);
  if (secrets.length === 0) return SESSION_ID_PATTERN.test(cookieValue) ? cookieValue : null;

  const separatorIndex = cookieValue.indexOf('.');
  if (separatorIndex === -1) return null;
  const sessionId = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return null;
  return secrets.some((secret) => signaturesMatch(signature, signSessionId(sessionId, secret)))
    ? sessionId
    : null;
}

function sanitizeUser(user) {
  const { password, passwordHash, password_hash: passwordHashColumn, ...safeUser } = user;

  void password;
  void passwordHash;
  void passwordHashColumn;

  return safeUser;
}

async function createSession(redis, user, options = {}) {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    user: sanitizeUser(user),
    csrfToken: crypto.randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
  };
  const key = sessionKey(sessionId);

  await setJson(redis, key, session, { ttlSeconds });

  const [currentSecret] = configuredSessionSecrets(options);
  const cookieValue = signedSessionValue(sessionId, currentSecret);

  return {
    sessionId,
    key,
    session,
    cookieValue,
    cookieHeader: sessionCookie(cookieValue, ttlSeconds, options),
  };
}

async function getSession(redis, cookieHeader, options = {}) {
  const sessionId = getSessionId(cookieHeader, options);
  if (!sessionId) return null;

  const session = await getJson(redis, sessionKey(sessionId));
  if (!session) return null;

  return {
    ...session,
    id: sessionId,
  };
}

async function destroySession(redis, cookieHeader, options = {}) {
  const sessionId = getSessionId(cookieHeader, options);
  if (!sessionId) return false;

  return deleteKey(redis, sessionKey(sessionId));
}

module.exports = {
  AICO_SESSION_COOKIE,
  DEFAULT_SESSION_TTL_SECONDS,
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  hashPassword,
  sessionCookie,
  signedSessionValue,
  verifyPassword,
};
