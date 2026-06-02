const assert = require('node:assert/strict');
const test = require('node:test');

const { createSession, hashPassword } = require('../src/auth');
const { createServer } = require('../src/server');

class FakeRedis {
  constructor() {
    this.store = new Map();
    this.deletedKeys = [];
  }

  async set(key, value) {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async del(key) {
    this.deletedKeys.push(key);
    return this.store.delete(key) ? 1 : 0;
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function form(data) {
  return new URLSearchParams(data);
}

function sqlIncludes(text, expected) {
  return text.replace(/\s+/g, ' ').includes(expected);
}

function createFakePool(handler) {
  const calls = [];

  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return handler(text, params, calls);
    },
  };
}

function createAdminServer({ pool, redis }) {
  return createServer({
    pool,
    redis,
    services: [],
    csrfProtection: false,
    sessionSecret: 'test-session-secret',
    verifyToken: 'secret',
    sendMessage: async () => {},
  });
}

async function sessionCookie(redis, user = {}) {
  const session = await createSession(redis, {
    id: 10,
    office_id: 1,
    email: 'admin@slsu.edu.ph',
    full_name: 'Bootstrap Admin',
    role: 'admin',
    ...user,
  });

  return {
    key: session.key,
    cookie: session.cookieHeader.split(';')[0],
  };
}

test('admin login creates a session cookie and stores only sanitized user data', async () => {
  const redis = new FakeRedis();
  const passwordHash = hashPassword('Secret123!');
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM users') && sqlIncludes(text, 'lower(email) = lower($1)')) {
      assert.deepEqual(params, ['admin@slsu.edu.ph']);
      return {
        rows: [
          {
            id: 1,
            office_id: 5,
            email: 'admin@slsu.edu.ph',
            full_name: 'Bootstrap Administrator',
            password_hash: passwordHash,
            role: 'admin',
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'admin@slsu.edu.ph', password: 'Secret123!' }),
      redirect: 'manual',
    });
    const cookie = response.headers.get('set-cookie');
    const sessionKey = [...redis.store.keys()].find((key) => key.startsWith('session:'));
    const storedSession = JSON.parse(await redis.get(sessionKey));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    assert.match(cookie, /aico_session=/);
    assert.deepEqual(storedSession.user, {
      id: 1,
      office_id: 5,
      email: 'admin@slsu.edu.ph',
      full_name: 'Bootstrap Administrator',
      name: 'Bootstrap Administrator',
      role: 'admin',
    });
    assert.equal(Object.hasOwn(storedSession.user, 'password'), false);
    assert.equal(Object.hasOwn(storedSession.user, 'password_hash'), false);
  } finally {
    await close(server);
  }
});

test('logout destroys the current session and expires the browser cookie', async () => {
  const redis = new FakeRedis();
  const { key, cookie } = await sessionCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('logout should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/logout`, {
      headers: { cookie },
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
    assert.match(response.headers.get('set-cookie'), /aico_session=; .*Max-Age=0/);
    assert.equal(await redis.get(key), null);
    assert.deepEqual(redis.deletedKeys, [key]);
  } finally {
    await close(server);
  }
});

test('expired admin sessions are redirected to login before any admin query runs', async () => {
  const redis = new FakeRedis();
  const { key, cookie } = await sessionCookie(redis);
  await redis.del(key);
  redis.deletedKeys = [];
  const pool = createFakePool(() => {
    throw new Error('expired session should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie },
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
    assert.deepEqual(pool.calls, []);
  } finally {
    await close(server);
  }
});

test('role gates allow office dashboards while blocking admin-only review routes', async () => {
  const redis = new FakeRedis();
  const { cookie } = await sessionCookie(redis, {
    id: 22,
    office_id: 7,
    email: 'editor@slsu.edu.ph',
    full_name: 'Office Editor',
    role: 'office_user',
  });
  const pool = createFakePool(async (text, params) => {
    if (
      sqlIncludes(text, 'FROM content_versions cv') &&
      sqlIncludes(text, 'cv.submitted_by = $2')
    ) {
      assert.deepEqual(params, [7, 22, 20, 0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const dashboard = await fetch(`${baseUrl}/admin`, { headers: { cookie } });
    const dashboardHtml = await dashboard.text();
    const reviews = await fetch(`${baseUrl}/admin/reviews`, { headers: { cookie } });
    const reviewsHtml = await reviews.text();

    assert.equal(dashboard.status, 200);
    assert.match(dashboardHtml, /Office dashboard/);
    assert.match(dashboardHtml, /Submit new content/);
    assert.equal(reviews.status, 403);
    assert.match(reviewsHtml, /do not have access/);
    assert.doesNotMatch(reviewsHtml, /Content reviews/);
  } finally {
    await close(server);
  }
});
