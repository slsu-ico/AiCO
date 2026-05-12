const assert = require('node:assert/strict');
const test = require('node:test');

const { createSession, hashPassword } = require('../src/auth');
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

function form(data) {
  return new URLSearchParams(data);
}

function sqlIncludes(text, expected) {
  return text.replace(/\s+/g, ' ').includes(expected);
}

function createFakePool(handler) {
  const calls = [];
  const client = {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return handler(text, params, calls);
    },
    release() {
      calls.push({ text: 'release', params: [] });
    },
  };

  return {
    calls,
    client,
    async query(text, params = []) {
      calls.push({ text, params });
      return handler(text, params, calls);
    },
    async connect() {
      calls.push({ text: 'connect', params: [] });
      return client;
    },
  };
}

function createAdminServer({ pool, redis = new FakeRedis() }) {
  return createServer({
    pool,
    redis,
    services: [],
    sessionSecret: 'test-session-secret',
    verifyToken: 'secret',
    sendMessage: async () => {},
  });
}

async function adminCookie(redis, user = {}) {
  const session = await createSession(redis, {
    id: 10,
    email: 'admin@slsu.edu.ph',
    full_name: 'Bootstrap Admin',
    role: 'admin',
    ...user,
  });

  return session.cookieHeader.split(';')[0];
}

test('renders the public account request form', async () => {
  const server = createAdminServer({ pool: createFakePool(() => ({ rows: [] })) });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/request-account`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Southern Luzon State University/);
    assert.match(html, /name="full_name"/);
    assert.match(html, /name="requested_office_name"/);
    assert.match(html, /name="reason"/);
  } finally {
    await close(server);
  }
});

test('submits an account request with pending status', async () => {
  let insertCall;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'INSERT INTO account_requests')) {
      insertCall = { text, params };
      return { rows: [{ id: 77 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/request-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        full_name: 'Maria Santos',
        email: 'maria@slsu.edu.ph',
        requested_office_name: 'Registrar',
        position: 'Office Staff',
        reason: 'Maintain office service content',
        remarks: 'Submitted by unit head',
      }),
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/request-account?submitted=1');
    assert.ok(insertCall);
    assert.deepEqual(insertCall.params, [
      'Maria Santos',
      'maria@slsu.edu.ph',
      'Registrar',
      'Office Staff',
      'Maintain office service content',
      'Submitted by unit head',
      'pending',
    ]);
  } finally {
    await close(server);
  }
});

test('logs in a seeded bootstrap admin and opens the admin dashboard', async () => {
  const redis = new FakeRedis();
  const passwordHash = hashPassword('Secret123!');
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM users') && sqlIncludes(text, 'lower(email) = lower($1)')) {
      assert.deepEqual(params, ['admin@slsu.edu.ph']);
      return {
        rows: [{
          id: 1,
          email: 'admin@slsu.edu.ph',
          password_hash: passwordHash,
          full_name: 'Bootstrap Administrator',
          role: 'admin',
          office_id: 5,
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'admin@slsu.edu.ph', password: 'Secret123!' }),
      redirect: 'manual',
    });

    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/admin');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /aico_session=/);

    const dashboard = await fetch(`${baseUrl}/admin`, {
      headers: { cookie },
    });
    const html = await dashboard.text();

    assert.equal(dashboard.status, 200);
    assert.match(html, /Admin dashboard/);
    assert.match(html, /Bootstrap Administrator/);
  } finally {
    await close(server);
  }
});

test('redirects unauthenticated admin requests to login', async () => {
  const server = createAdminServer({ pool: createFakePool(() => ({ rows: [] })) });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
  } finally {
    await close(server);
  }
});

test('admin approval creates an active user from an account request', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  let insertedUserParams;
  let approvedParams;
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'FROM account_requests') && sqlIncludes(text, 'WHERE id = $1')) {
      return {
        rows: [{
          id: 42,
          full_name: 'Juan Dela Cruz',
          email: 'juan@slsu.edu.ph',
          position: 'Coordinator',
          status: 'pending',
        }],
      };
    }
    if (sqlIncludes(text, 'INSERT INTO users')) {
      insertedUserParams = params;
      return { rows: [{ id: 88 }] };
    }
    if (sqlIncludes(text, "SET status = 'approved'")) {
      approvedParams = params;
      return { rows: [{ id: 42 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests/42/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({
        office_id: '3',
        role: 'office_user',
        password: 'TempPass123!',
      }),
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/account-requests');
    assert.equal(insertedUserParams[0], 3);
    assert.equal(insertedUserParams[1], 'juan@slsu.edu.ph');
    assert.match(insertedUserParams[2], /^scrypt:v1:N=16384,r=8,p=1,keylen=64:/);
    assert.notEqual(insertedUserParams[2], 'TempPass123!');
    assert.equal(insertedUserParams[3], 'Juan Dela Cruz');
    assert.equal(insertedUserParams[4], 'office_user');
    assert.equal(insertedUserParams[5], true);
    assert.deepEqual(approvedParams, [42, 10, '', 3]);
  } finally {
    await close(server);
  }
});

test('rejecting an account request without an admin note returns 400', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('query should not run without an admin note');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests/42/reject`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({ admin_note: '   ' }),
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Admin note is required/);
  } finally {
    await close(server);
  }
});
