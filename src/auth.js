const crypto = require('node:crypto');

const { deleteKey, getJson, setJson } = require('./cache/redis');
const { hashPassword, verifyPassword } = require('./passwordHash');

const AICO_SESSION_COOKIE = 'aico_session';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function getSessionId(cookieHeader) {
  const sessionId = parseCookies(cookieHeader)[AICO_SESSION_COOKIE];
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return null;
  return sessionId;
}

function sanitizeUser(user) {
  const {
    password,
    passwordHash,
    password_hash: passwordHashColumn,
    ...safeUser
  } = user;

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
    createdAt: new Date().toISOString(),
  };
  const key = sessionKey(sessionId);

  await setJson(redis, key, session, { ttlSeconds });

  return {
    sessionId,
    key,
    session,
    cookieValue: sessionId,
    cookieHeader: sessionCookie(sessionId, ttlSeconds, options),
  };
}

async function getSession(redis, cookieHeader) {
  const sessionId = getSessionId(cookieHeader);
  if (!sessionId) return null;

  const session = await getJson(redis, sessionKey(sessionId));
  if (!session) return null;

  return {
    ...session,
    id: sessionId,
  };
}

async function destroySession(redis, cookieHeader) {
  const sessionId = getSessionId(cookieHeader);
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
  verifyPassword,
};
