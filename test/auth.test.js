const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AICO_SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  getSession,
  hashPassword,
  verifyPassword,
  destroySession,
  sessionCookie,
} = require('../src/auth');
const { deleteKey, getJson, setJson } = require('../src/cache/redis');

class FakeRedis {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
  }

  async set(key, value, options) {
    this.store.set(key, value);
    if (options?.expiration) {
      this.expirations.set(key, options.expiration);
    }
    return 'OK';
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async del(key) {
    const existed = this.store.delete(key);
    this.expirations.delete(key);
    return existed ? 1 : 0;
  }
}

test('auth verifies passwords through passwordHash helpers', () => {
  const encoded = hashPassword('CorrectHorseBatteryStaple!');

  assert.equal(verifyPassword('CorrectHorseBatteryStaple!', encoded), true);
  assert.equal(verifyPassword('wrong-password', encoded), false);
});

test('Redis JSON helpers round-trip values and delete keys', async () => {
  const redis = new FakeRedis();

  await setJson(redis, 'example:key', { ok: true }, { ttlSeconds: 15 });

  assert.deepEqual(await getJson(redis, 'example:key'), { ok: true });
  assert.deepEqual(redis.expirations.get('example:key'), { type: 'EX', value: 15 });
  assert.equal(await deleteKey(redis, 'example:key'), true);
  assert.equal(await getJson(redis, 'example:key'), null);
});

test('createSession stores an opaque Redis session and returns cookie helpers', async () => {
  const redis = new FakeRedis();
  const user = {
    id: 7,
    email: 'admin@slsu.edu.ph',
    role: 'admin',
    passwordHash: 'do-not-store',
  };

  const created = await createSession(redis, user, { ttlSeconds: 60 });

  assert.match(created.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(created.key, `session:${created.sessionId}`);
  assert.equal(created.cookieValue, created.sessionId);
  assert.equal(
    created.cookieHeader,
    `${AICO_SESSION_COOKIE}=${created.sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=60`,
  );
  assert.deepEqual(redis.expirations.get(created.key), { type: 'EX', value: 60 });

  const stored = JSON.parse(await redis.get(created.key));
  assert.deepEqual(stored.user, {
    id: 7,
    email: 'admin@slsu.edu.ph',
    role: 'admin',
  });
  assert.equal(typeof stored.createdAt, 'string');
});

test('getSession loads a valid session from a cookie header', async () => {
  const redis = new FakeRedis();
  const created = await createSession(redis, { id: 9, email: 'office@slsu.edu.ph' });

  const session = await getSession(redis, `theme=light; ${AICO_SESSION_COOKIE}=${created.cookieValue}`);

  assert.equal(session.id, created.sessionId);
  assert.deepEqual(session.user, { id: 9, email: 'office@slsu.edu.ph' });
});

test('getSession falls back to the process session shadow when Redis is unavailable', async () => {
  const redis = new FakeRedis();
  const created = await createSession(redis, { id: 9, email: 'office@slsu.edu.ph' });
  redis.get = async () => {
    throw new Error('Redis connection dropped');
  };

  const session = await getSession(redis, `${AICO_SESSION_COOKIE}=${created.cookieValue}`);

  assert.equal(session.id, created.sessionId);
  assert.deepEqual(session.user, { id: 9, email: 'office@slsu.edu.ph' });
});

test('getSession rejects missing or tampered session cookies', async () => {
  const redis = new FakeRedis();
  await createSession(redis, { id: 2, email: 'admin@slsu.edu.ph' });

  assert.equal(await getSession(redis, ''), null);
  assert.equal(await getSession(redis, `${AICO_SESSION_COOKIE}=not-a-uuid`), null);
  assert.equal(await getSession(redis, `${AICO_SESSION_COOKIE}=00000000-0000-4000-8000-000000000000`), null);
});

test('getSession and destroySession reject malformed percent-encoded session cookies', async () => {
  const redis = new FakeRedis();
  await createSession(redis, { id: 2, email: 'admin@slsu.edu.ph' });

  assert.equal(await getSession(redis, `${AICO_SESSION_COOKIE}=%E0%A4%A`), null);
  assert.equal(await destroySession(redis, `${AICO_SESSION_COOKIE}=%E0%A4%A`), false);
});

test('session cookies include Secure when explicitly enabled', () => {
  assert.equal(
    sessionCookie('00000000-0000-4000-8000-000000000000', 60, { secure: true }),
    `${AICO_SESSION_COOKIE}=00000000-0000-4000-8000-000000000000; HttpOnly; SameSite=Lax; Path=/; Max-Age=60; Secure`,
  );
  assert.equal(
    clearSessionCookie({ secure: true }),
    `${AICO_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
  );
});

test('session cookies infer Secure in production unless explicitly disabled', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    assert.equal(
      sessionCookie('00000000-0000-4000-8000-000000000000', 60),
      `${AICO_SESSION_COOKIE}=00000000-0000-4000-8000-000000000000; HttpOnly; SameSite=Lax; Path=/; Max-Age=60; Secure`,
    );
    assert.equal(
      clearSessionCookie(),
      `${AICO_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
    );
    assert.equal(
      sessionCookie('00000000-0000-4000-8000-000000000000', 60, { secure: false }),
      `${AICO_SESSION_COOKIE}=00000000-0000-4000-8000-000000000000; HttpOnly; SameSite=Lax; Path=/; Max-Age=60`,
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('destroySession deletes the Redis session and clearSessionCookie expires the cookie', async () => {
  const redis = new FakeRedis();
  const created = await createSession(redis, { id: 4, email: 'admin@slsu.edu.ph' });

  assert.equal(await destroySession(redis, `${AICO_SESSION_COOKIE}=${created.cookieValue}`), true);
  assert.equal(await redis.get(created.key), null);
  assert.equal(await getSession(redis, `${AICO_SESSION_COOKIE}=${created.cookieValue}`), null);
  assert.equal(
    clearSessionCookie(),
    `${AICO_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
});
