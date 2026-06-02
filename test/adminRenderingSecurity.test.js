const assert = require('node:assert/strict');
const test = require('node:test');

const { createSession } = require('../src/auth');
const { createServer } = require('../src/server');

class FakeRedis {
  constructor() {
    this.store = new Map();
  }

  async set(key, value) {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async del(key) {
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

function sqlIncludes(text, expected) {
  return text.replace(/\s+/g, ' ').includes(expected);
}

function createFakePool(handler) {
  return {
    async query(text, params = []) {
      return handler(text, params);
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

async function adminCookie(redis) {
  const session = await createSession(redis, {
    id: 10,
    office_id: 1,
    email: 'admin@slsu.edu.ph',
    full_name: 'Bootstrap Admin',
    role: 'admin',
  });

  return session.cookieHeader.split(';')[0];
}

test('account request review pages escape stored requester fields before rendering', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'FROM account_requests')) {
      return {
        rows: [
          {
            id: 42,
            full_name: '<img src=x onerror=alert(1)>',
            email: 'attacker@example.test"><script>alert(1)</script>',
            requested_office_name: '<svg onload=alert(1)>',
            position: 'Coordinator & reviewer',
            status: 'pending',
            created_at: '2026-05-12T02:00:00.000Z',
            total_count: '1',
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<svg onload=alert\(1\)>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /attacker@example\.test&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
    assert.match(html, /Coordinator &amp; reviewer/);
  } finally {
    await close(server);
  }
});
