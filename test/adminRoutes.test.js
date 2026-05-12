const assert = require('node:assert/strict');
const test = require('node:test');

const { createSession, hashPassword } = require('../src/auth');
const { createServer } = require('../src/server');

class FakeRedis {
  constructor() {
    this.store = new Map();
    this.delCalls = [];
  }

  async set(key, value) {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async del(key) {
    this.delCalls.push(key);
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
    office_id: 1,
    email: 'admin@slsu.edu.ph',
    full_name: 'Bootstrap Admin',
    role: 'admin',
    ...user,
  });

  return session.cookieHeader.split(';')[0];
}

async function officeCookie(redis, user = {}) {
  return adminCookie(redis, {
    id: 22,
    office_id: 7,
    email: 'editor@slsu.edu.ph',
    full_name: 'Office Editor',
    role: 'office_user',
    ...user,
  });
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

test('renders new content form only for authenticated office users', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('new content form should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const unauthenticated = await fetch(`${baseUrl}/admin/content/new`, { redirect: 'manual' });
    assert.equal(unauthenticated.status, 303);
    assert.equal(unauthenticated.headers.get('location'), '/login');

    const response = await fetch(`${baseUrl}/admin/content/new`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /New content/);
    assert.match(html, /name="content_type"/);
    assert.match(html, /citizens_charter_service/);
  } finally {
    await close(server);
  }
});

test('office user submits content for their assigned office as pending review', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { office_id: 7 });
  let itemParams;
  let versionParams;
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO content_items')) {
      itemParams = params;
      return { rows: [{ id: 900 }] };
    }
    if (sqlIncludes(text, 'INSERT INTO content_versions')) {
      versionParams = params;
      return { rows: [{ id: 901 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/content`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({
        office_id: '7',
        content_type: 'faq',
        title: 'How do I request international documents?',
        body: 'Submit the request form and wait for confirmation.',
      }),
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/content/new?submitted=1');
    assert.deepEqual(itemParams, [7, 'faq', 22]);
    assert.equal(versionParams[0], 900);
    assert.equal(versionParams[1], 1);
    assert.equal(versionParams[2], 'pending_review');
    assert.equal(versionParams[3], 'How do I request international documents?');
    assert.equal(versionParams[4], 'Submit the request form and wait for confirmation.');
    assert.deepEqual(versionParams[5], {
      title: 'How do I request international documents?',
      body: 'Submit the request form and wait for confirmation.',
      office_id: 7,
      content_type: 'faq',
    });
    assert.equal(versionParams[6], 22);
  } finally {
    await close(server);
  }
});

test('authenticated user can create attachment metadata with sanitized original filename and uploaded_by', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { id: 44, office_id: 7 });
  let attachmentParams;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, 'JOIN content_items ci')) {
      assert.deepEqual(params, [901]);
      return { rows: [{ id: 901, office_id: 7 }] };
    }
    if (sqlIncludes(text, 'INSERT INTO attachments')) {
      attachmentParams = params;
      return { rows: [{ id: 123 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        linked_type: 'content_version',
        linked_id: 901,
        original_filename: '../unsafe\u0000 path/Board\nResolution Final.pdf',
        file_type: 'application/pdf',
        file_size: 2048,
        storage_path: 'uploads/123-board-resolution-final.pdf',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(payload, { id: 123 });
    assert.deepEqual(attachmentParams, [
      'content_version',
      901,
      'BoardResolution Final.pdf',
      'application/pdf',
      2048,
      'uploads/123-board-resolution-final.pdf',
      44,
    ]);
  } finally {
    await close(server);
  }
});

test('attachment metadata rejects traversal storage path', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('invalid storage path should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        linked_type: 'content_version',
        linked_id: 901,
        original_filename: 'Board Resolution Final.pdf',
        file_type: 'application/pdf',
        file_size: 2048,
        storage_path: 'uploads/../private/secret.pdf',
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /valid attachment storage record/);
  } finally {
    await close(server);
  }
});

test('attachment metadata rejects bogus linked_type', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('invalid linked_type should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        linked_type: 'content_item',
        linked_id: 901,
        original_filename: 'Board Resolution Final.pdf',
        file_type: 'application/pdf',
        file_size: 2048,
        storage_path: 'uploads/123-board-resolution-final.pdf',
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /valid linked item/);
  } finally {
    await close(server);
  }
});

test('office user cannot attach metadata to another office content version', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { office_id: 7 });
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, 'JOIN content_items ci')) {
      assert.deepEqual(params, [901]);
      return { rows: [{ id: 901, office_id: 99 }] };
    }
    if (sqlIncludes(text, 'INSERT INTO attachments')) {
      throw new Error('unauthorized attachment should not be inserted');
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        linked_type: 'content_version',
        linked_id: 901,
        original_filename: 'Board Resolution Final.pdf',
        file_type: 'application/pdf',
        file_size: 2048,
        storage_path: 'uploads/123-board-resolution-final.pdf',
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /another office/);
  } finally {
    await close(server);
  }
});

test('office user cannot submit content for another office', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { office_id: 7 });
  const pool = createFakePool(() => {
    throw new Error('cross-office submission should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/content`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({
        office_id: '99',
        content_type: 'program',
        title: 'Exchange Program',
        body: 'Program details.',
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /assigned office/);
  } finally {
    await close(server);
  }
});

test('office user cannot access admin content review routes', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('office users should not query admin reviews');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/reviews`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /do not have access/);
  } finally {
    await close(server);
  }
});

test('admin can view pending content review list and detail', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, "cv.status = 'pending_review'")) {
      return {
        rows: [{
          id: 55,
          title: 'Scholarship FAQ',
          content_type: 'faq',
          office_name: 'International Office',
          submitted_at: '2026-05-12T02:00:00.000Z',
        }],
      };
    }
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, 'WHERE cv.id = $1')) {
      assert.deepEqual(params, [55]);
      return {
        rows: [{
          id: 55,
          title: 'Scholarship FAQ',
          body: 'Bring the scholarship certificate.',
          status: 'pending_review',
          content_type: 'faq',
          office_id: 7,
          office_name: 'International Office',
          structured_payload: { title: 'Scholarship FAQ' },
          submitted_at: '2026-05-12T02:00:00.000Z',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const list = await fetch(`${baseUrl}/admin/reviews`, { headers: { cookie } });
    const listHtml = await list.text();
    assert.equal(list.status, 200);
    assert.match(listHtml, /Content reviews/);
    assert.match(listHtml, /Scholarship FAQ/);

    const detail = await fetch(`${baseUrl}/admin/reviews/55`, { headers: { cookie } });
    const detailHtml = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detailHtml, /Bring the scholarship certificate/);
    assert.match(detailHtml, /name="note"/);
  } finally {
    await close(server);
  }
});

test('admin approval publishes content and invalidates published caches', async () => {
  const redis = new FakeRedis();
  await redis.set('published:services', 'cached services');
  await redis.set('published:faqs', 'cached faqs');
  const cookie = await adminCookie(redis);
  let versionUpdateParams;
  let itemUpdateParams;
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'FROM content_versions') && sqlIncludes(text, 'FOR UPDATE')) {
      assert.deepEqual(params, [55]);
      return {
        rows: [{
          id: 55,
          content_item_id: 90,
          status: 'pending_review',
        }],
      };
    }
    if (sqlIncludes(text, "SET status = 'published'")) {
      versionUpdateParams = params;
      return { rows: [{ id: 55, content_item_id: 90 }] };
    }
    if (sqlIncludes(text, 'current_published_version_id = $2')) {
      itemUpdateParams = params;
      return { rows: [{ id: 90 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/reviews/55/approve`, {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/reviews');
    assert.deepEqual(versionUpdateParams, [55, 10]);
    assert.deepEqual(itemUpdateParams, [90, 55]);
    assert.equal(await redis.get('published:services'), null);
    assert.equal(await redis.get('published:faqs'), null);
    assert.deepEqual(redis.delCalls, ['published:services', 'published:faqs']);
  } finally {
    await close(server);
  }
});

test('reject and needs-revision review actions require notes', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('review action without a note should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    for (const action of ['reject', 'needs-revision']) {
      const response = await fetch(`${baseUrl}/admin/reviews/55/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
        },
        body: form({ note: '   ' }),
      });
      const html = await response.text();

      assert.equal(response.status, 400);
      assert.match(html, /Review note is required/);
    }
  } finally {
    await close(server);
  }
});

test('needs-revision review action stores reviewer note', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  let versionUpdateParams;
  let noteParams;
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'FROM content_versions') && sqlIncludes(text, 'FOR UPDATE')) {
      return {
        rows: [{
          id: 55,
          content_item_id: 90,
          status: 'pending_review',
        }],
      };
    }
    if (sqlIncludes(text, 'UPDATE content_versions') && sqlIncludes(text, 'status = $2')) {
      versionUpdateParams = params;
      return { rows: [{ id: 55 }] };
    }
    if (sqlIncludes(text, 'INSERT INTO review_notes')) {
      noteParams = params;
      return { rows: [{ id: 500 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/reviews/55/needs-revision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({ note: 'Please add processing time and requirements.' }),
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/reviews/55');
    assert.deepEqual(versionUpdateParams, [55, 'needs_revision', 10]);
    assert.deepEqual(noteParams, [55, 10, 'needs_revision', 'Please add processing time and requirements.']);
  } finally {
    await close(server);
  }
});
