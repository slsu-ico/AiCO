const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

function createAdminServer({
  pool,
  redis = new FakeRedis(),
  uploadDir,
  csrfProtection = false,
  sessionSecret = 'test-session-secret',
}) {
  return createServer({
    pool,
    redis,
    uploadDir,
    services: [],
    csrfProtection,
    sessionSecret,
    verifyToken: 'secret',
    sendMessage: async () => {},
  });
}

function createHardenedAdminServer(options) {
  return createAdminServer({
    ...options,
    csrfProtection: true,
    sessionSecret: 'test-session-secret',
  });
}

function extractCsrfToken(html) {
  const match = html.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/);
  return match ? match[1] : '';
}

async function tempUploadDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aico-admin-uploads-'));
}

function multipartBody(parts, boundary = '----aico-test-boundary') {
  const chunks = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        + `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`,
      ));
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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

test('HTML responses include a restrictive Content-Security-Policy header', async () => {
  const server = createAdminServer({ pool: createFakePool(() => ({ rows: [] })) });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/request-account`);

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-security-policy'),
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
  } finally {
    await close(server);
  }
});

test('hardened forms include CSRF tokens and reject forged admin POSTs', async () => {
  const redis = new FakeRedis();
  await redis.set('published:services', 'cached services');
  const cookie = await adminCookie(redis);
  const pool = createFakePool((text, params = []) => {
    if (sqlIncludes(text, 'pending_account_requests')
      && sqlIncludes(text, 'pending_content_reviews')
      && sqlIncludes(text, 'published_records')) {
      return {
        rows: [{
          pending_account_requests: '0',
          pending_content_reviews: '0',
          published_records: '1',
        }],
      };
    }
    if (sqlIncludes(text, 'FROM content_items ci')
      && params[0] === 'citizens_charter_service') {
      return { rows: [{ structured_payload: { id: 'warmed-service' } }] };
    }
    if (sqlIncludes(text, 'FROM content_items ci') && params[0] === 'faq') {
      return { rows: [{ structured_payload: { question: 'Warmed FAQ', answer: 'Cached.' } }] };
    }
    throw new Error('forged cache refresh should not query the database');
  });
  const server = createHardenedAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const dashboard = await fetch(`${baseUrl}/admin`, { headers: { cookie } });
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(html, /name="_csrf"/);

    const forged = await fetch(`${baseUrl}/admin/cache/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    const forgedText = await forged.text();

    assert.equal(forged.status, 403);
    assert.match(forgedText, /Invalid CSRF token/);
    assert.equal(await redis.get('published:services'), 'cached services');
    assert.deepEqual(redis.delCalls, []);

    const token = extractCsrfToken(html);
    const legitimate = await fetch(`${baseUrl}/admin/cache/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({ _csrf: token }),
      redirect: 'manual',
    });

    assert.equal(legitimate.status, 303);
    assert.equal(legitimate.headers.get('location'), '/admin?cache_refreshed=1');
    assert.equal(await redis.get('published:services'), JSON.stringify([{ id: 'warmed-service' }]));
  } finally {
    await close(server);
  }
});

test('login attempts are rate limited by client IP', async () => {
  const redis = new FakeRedis();
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'FROM users') && sqlIncludes(text, 'lower(email) = lower($1)')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createHardenedAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '203.0.113.44',
        },
        body: form({ email: 'admin@slsu.edu.ph', password: 'bad-password' }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '203.0.113.44',
      },
      body: form({ email: 'admin@slsu.edu.ph', password: 'bad-password' }),
    });
    const html = await limited.text();

    assert.equal(limited.status, 429);
    assert.match(html, /Too many login attempts/);
  } finally {
    await close(server);
  }
});

test('account request rejects overlong public text fields before inserting', async () => {
  const pool = createFakePool(() => {
    throw new Error('overlong account request should not query the database');
  });
  const server = createHardenedAdminServer({ pool });
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
        reason: 'x'.repeat(2001),
        remarks: 'Submitted by unit head',
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Reason must be 2000 characters or fewer/);
  } finally {
    await close(server);
  }
});

test('office content submission rejects overlong body before inserting', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { office_id: 7 });
  const pool = createFakePool(() => {
    throw new Error('overlong content should not query the database');
  });
  const server = createHardenedAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const formPage = await fetch(`${baseUrl}/admin/content/new`, { headers: { cookie } });
    const token = extractCsrfToken(await formPage.text());
    const response = await fetch(`${baseUrl}/admin/content`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: form({
        _csrf: token,
        office_id: '7',
        content_type: 'faq',
        title: 'Scholarship FAQ',
        body: 'x'.repeat(10001),
      }),
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Body must be 10000 characters or fewer/);
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
    if (sqlIncludes(text, 'pending_account_requests')
      && sqlIncludes(text, 'pending_content_reviews')
      && sqlIncludes(text, 'published_records')) {
      return {
        rows: [{
          pending_account_requests: '0',
          pending_content_reviews: '0',
          published_records: '0',
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

test('admin dashboard shows pending account, pending review, and published counts', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'pending_account_requests')
      && sqlIncludes(text, 'pending_content_reviews')
      && sqlIncludes(text, 'published_records')) {
      return {
        rows: [{
          pending_account_requests: '4',
          pending_content_reviews: '7',
          published_records: '19',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Admin dashboard/);
    assert.match(html, /Pending account requests/);
    assert.match(html, /<strong>4<\/strong>/);
    assert.match(html, /Pending content reviews/);
    assert.match(html, /<strong>7<\/strong>/);
    assert.match(html, /Published records/);
    assert.match(html, /<strong>19<\/strong>/);
    assert.match(html, /action="\/admin\/cache\/refresh"/);
    assert.match(html, /Refresh cache/);
    assert.match(html, /href="\/admin\/account-requests"/);
    assert.match(html, /href="\/admin\/reviews"/);
    assert.doesNotMatch(html, /My submissions/);
    assert.doesNotMatch(html, /Submit new content/);
  } finally {
    await close(server);
  }
});

test('admin database errors render a generic internal error page', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('database stack trace: password_hash from users');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 500);
    assert.match(html, /Internal Server Error/);
    assert.doesNotMatch(html, /database stack trace/);
    assert.doesNotMatch(html, /password_hash/);
  } finally {
    await close(server);
  }
});

test('admin can refresh published caches from the dashboard action', async () => {
  const redis = new FakeRedis();
  await redis.set('published:services', 'cached services');
  await redis.set('published:faqs', 'cached faqs');
  const cookie = await adminCookie(redis);
  const pool = createFakePool((text, params = []) => {
    if (sqlIncludes(text, 'FROM content_items ci')
      && params[0] === 'citizens_charter_service') {
      return { rows: [{ structured_payload: { id: 'warmed-service' } }] };
    }
    if (sqlIncludes(text, 'FROM content_items ci') && params[0] === 'faq') {
      return { rows: [{ structured_payload: { question: 'Warmed FAQ', answer: 'Cached.' } }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/cache/refresh`, {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin?cache_refreshed=1');
    assert.equal(await redis.get('published:services'), JSON.stringify([{ id: 'warmed-service' }]));
    assert.equal(await redis.get('published:faqs'), JSON.stringify([{ question: 'Warmed FAQ', answer: 'Cached.' }]));
    assert.deepEqual(redis.delCalls, ['published:services', 'published:faqs']);
  } finally {
    await close(server);
  }
});

test('admin dashboard confirms when published caches were refreshed', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'pending_account_requests')
      && sqlIncludes(text, 'pending_content_reviews')
      && sqlIncludes(text, 'published_records')) {
      return {
        rows: [{
          pending_account_requests: '0',
          pending_content_reviews: '0',
          published_records: '2',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin?cache_refreshed=1`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Published chatbot cache refreshed/);
  } finally {
    await close(server);
  }
});

test('office user cannot refresh published caches', async () => {
  const redis = new FakeRedis();
  await redis.set('published:services', 'cached services');
  await redis.set('published:faqs', 'cached faqs');
  const cookie = await officeCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('unauthorized cache refresh should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/cache/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /do not have access/);
    assert.equal(await redis.get('published:services'), 'cached services');
    assert.equal(await redis.get('published:faqs'), 'cached faqs');
    assert.deepEqual(redis.delCalls, []);
  } finally {
    await close(server);
  }
});

test('cache refresh action requires POST', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('GET cache refresh should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/cache/refresh`, {
      headers: { cookie },
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(await response.text(), 'Method Not Allowed');
    assert.deepEqual(redis.delCalls, []);
  } finally {
    await close(server);
  }
});

test('office dashboard shows submissions with status and latest admin note', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { id: 22, office_id: 7 });
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv')
      && sqlIncludes(text, 'latest_note.note AS latest_admin_note')
      && sqlIncludes(text, 'cv.submitted_by = $2')) {
      assert.deepEqual(params, [7, 22, 20, 0]);
      return {
        rows: [{
          id: 901,
          title: 'Scholarship FAQ',
          content_type: 'faq',
          status: 'needs_revision',
          submitted_at: '2026-05-12T02:00:00.000Z',
          latest_admin_note: 'Please add the eligibility period.',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /My submissions/);
    assert.match(html, /Scholarship FAQ/);
    assert.match(html, /FAQ/);
    assert.match(html, /needs revision/);
    assert.match(html, /Please add the eligibility period\./);
    assert.match(html, /href="\/admin\/content\/new"/);
    assert.doesNotMatch(html, /Pending account requests/);
    assert.doesNotMatch(html, /Pending content reviews/);
    assert.doesNotMatch(html, /href="\/admin\/account-requests"/);
    assert.doesNotMatch(html, /href="\/admin\/reviews"/);
  } finally {
    await close(server);
  }
});

test('office dashboard paginates and filters submission history', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { id: 22, office_id: 7 });
  let queryParams;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv')
      && sqlIncludes(text, 'latest_note.note AS latest_admin_note')
      && sqlIncludes(text, 'cv.submitted_by = $2')) {
      queryParams = params;
      assert.ok(sqlIncludes(text, 'count(*) OVER() AS total_count'));
      assert.ok(sqlIncludes(text, 'LIMIT $5 OFFSET $6'));
      return {
        rows: [{
          id: 901,
          title: 'Scholarship FAQ',
          content_type: 'faq',
          status: 'needs_revision',
          submitted_at: '2026-05-12T02:00:00.000Z',
          latest_admin_note: 'Please add the eligibility period.',
          total_count: '45',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin?q=Scholarship&status=needs_revision&page=2`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(queryParams, [7, 22, 'needs_revision', '%Scholarship%', 20, 20]);
    assert.match(html, /name="q" type="search" value="Scholarship"/);
    assert.match(html, /value="needs_revision" selected/);
    assert.match(html, /Page 2 of 3/);
    assert.match(html, /href="\/admin\?q=Scholarship&amp;status=needs_revision&amp;page=1"/);
    assert.match(html, /href="\/admin\?q=Scholarship&amp;status=needs_revision&amp;page=3"/);
  } finally {
    await close(server);
  }
});

test('office submission history route uses the same paginated filters', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { id: 22, office_id: 7 });
  let queryParams;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv')
      && sqlIncludes(text, 'latest_note.note AS latest_admin_note')
      && sqlIncludes(text, 'cv.submitted_by = $2')) {
      queryParams = params;
      assert.ok(sqlIncludes(text, 'LIMIT $5 OFFSET $6'));
      return {
        rows: [{
          id: 901,
          title: 'Published FAQ',
          content_type: 'faq',
          status: 'published',
          submitted_at: '2026-05-12T02:00:00.000Z',
          latest_admin_note: '',
          total_count: '1',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/submissions?q=FAQ&status=published`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(queryParams, [7, 22, 'published', '%FAQ%', 20, 0]);
    assert.match(html, /Submission history/);
    assert.match(html, /Published FAQ/);
    assert.match(html, /aria-current="page" href="\/admin\/submissions"/);
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

test('admin account requests are paginated, filterable, and use modal review actions', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  let queryParams;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM account_requests')) {
      queryParams = params;
      assert.ok(sqlIncludes(text, 'count(*) OVER() AS total_count'));
      assert.ok(sqlIncludes(text, 'LIMIT $3 OFFSET $4'));
      return {
        rows: [{
          id: 42,
          full_name: 'Maria Santos',
          email: 'maria@slsu.edu.ph',
          requested_office_name: 'Registrar',
          position: 'Records Officer',
          status: 'pending',
          created_at: '2026-05-12T02:00:00.000Z',
          total_count: '28',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests?q=Maria&status=pending&page=2`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(queryParams, ['pending', '%Maria%', 20, 20]);
    assert.match(html, /name="q" type="search" value="Maria"/);
    assert.match(html, /value="pending" selected/);
    assert.match(html, /href="#request-42"/);
    assert.match(html, /class="action-modal" id="request-42"/);
    assert.match(html, /action="\/admin\/account-requests\/42\/approve"/);
    assert.match(html, /Page 2 of 2/);
    assert.doesNotMatch(html, /<td>\s*<form method="post" action="\/admin\/account-requests\/42\/approve"/);
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
    assert.equal(response.headers.get('location'), '/admin/account-requests?notice=approved');
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

test('account request action notices are shown after redirects', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'FROM account_requests')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests?notice=rejected`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Account request rejected/);
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
    assert.match(html, /enctype="multipart\/form-data"/);
    assert.match(html, /name="attachment"/);
  } finally {
    await close(server);
  }
});

test('admin cannot access office-only new content form', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('admin should not query the office-only new content form');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/content/new`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /do not have access/);
    assert.doesNotMatch(html, /name="content_type"/);
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

test('office user submits Citizen Charter content with a supporting file attachment', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { id: 44, office_id: 7 });
  const uploadDir = await tempUploadDir();
  let itemParams;
  let versionParams;
  let attachmentParams;
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
    if (sqlIncludes(text, 'INSERT INTO attachments')) {
      attachmentParams = params;
      return { rows: [{ id: 123 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis, uploadDir });
  const baseUrl = await listen(server);
  const multipart = multipartBody([
    { name: 'office_id', value: '7' },
    { name: 'content_type', value: 'citizens_charter_service' },
    { name: 'title', value: 'Certification Request' },
    { name: 'body', value: 'Updated Citizen Charter steps for certification requests.' },
    { name: 'requirements', value: 'Office request letter' },
    {
      name: 'attachment',
      filename: '../unsafe/Charter Update.pdf',
      contentType: 'application/pdf',
      value: Buffer.from('%PDF-1.4 charter update'),
    },
  ]);

  try {
    const response = await fetch(`${baseUrl}/admin/content`, {
      method: 'POST',
      headers: {
        'content-type': multipart.contentType,
        cookie,
      },
      body: multipart.body,
      redirect: 'manual',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/content/new?submitted=1');
    assert.deepEqual(itemParams, [7, 'citizens_charter_service', 44]);
    assert.equal(versionParams[0], 900);
    assert.equal(versionParams[2], 'pending_review');
    assert.equal(versionParams[3], 'Certification Request');
    assert.equal(attachmentParams[0], 'content_version');
    assert.equal(attachmentParams[1], 901);
    assert.equal(attachmentParams[2], 'Charter Update.pdf');
    assert.equal(attachmentParams[3], 'application/pdf');
    assert.equal(attachmentParams[4], Buffer.byteLength('%PDF-1.4 charter update'));
    assert.equal(attachmentParams[6], 44);
    assert.equal(path.dirname(path.resolve(attachmentParams[5])), path.resolve(uploadDir));
    assert.match(path.basename(attachmentParams[5]), /^[0-9a-f-]+-charter-update\.pdf$/);
    assert.equal(await fs.readFile(attachmentParams[5], 'utf8'), '%PDF-1.4 charter update');
  } finally {
    await close(server);
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});

test('office user content upload rejects unsupported supporting file types', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis, { office_id: 7 });
  const uploadDir = await tempUploadDir();
  const pool = createFakePool(() => {
    throw new Error('invalid upload should not query the database');
  });
  const server = createAdminServer({ pool, redis, uploadDir });
  const baseUrl = await listen(server);
  const multipart = multipartBody([
    { name: 'office_id', value: '7' },
    { name: 'content_type', value: 'citizens_charter_service' },
    { name: 'title', value: 'Certification Request' },
    { name: 'body', value: 'Updated Citizen Charter steps.' },
    {
      name: 'attachment',
      filename: 'script.js',
      contentType: 'application/javascript',
      value: Buffer.from('alert(1)'),
    },
  ]);

  try {
    const response = await fetch(`${baseUrl}/admin/content`, {
      method: 'POST',
      headers: {
        'content-type': multipart.contentType,
        cookie,
      },
      body: multipart.body,
    });
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Unsupported file type/);
  } finally {
    await close(server);
    await fs.rm(uploadDir, { recursive: true, force: true });
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

test('office user cannot access admin account request routes', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('office users should not query admin account requests');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/account-requests`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 403);
    assert.match(html, /do not have access/);
    assert.doesNotMatch(html, /Review requests/);
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

test('admin content reviews are paginated and searchable by title or office', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  let queryParams;
  const pool = createFakePool(async (text, params) => {
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, "cv.status = 'pending_review'")) {
      queryParams = params;
      assert.ok(sqlIncludes(text, 'count(*) OVER() AS total_count'));
      assert.ok(sqlIncludes(text, 'LIMIT $3 OFFSET $4'));
      return {
        rows: [{
          id: 55,
          title: 'Scholarship FAQ',
          content_type: 'faq',
          office_name: 'International Office',
          submitted_at: '2026-05-12T02:00:00.000Z',
          total_count: '41',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/reviews?q=Scholarship&type=faq&page=2`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(queryParams, ['faq', '%Scholarship%', 20, 20]);
    assert.match(html, /name="q" type="search" value="Scholarship"/);
    assert.match(html, /value="faq" selected/);
    assert.match(html, /Page 2 of 3/);
    assert.match(html, /href="\/admin\/reviews\?q=Scholarship&amp;type=faq&amp;page=1"/);
  } finally {
    await close(server);
  }
});

test('admin approval publishes content, invalidates caches, and warms published records', async () => {
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
    if (sqlIncludes(text, 'FROM content_items ci')
      && params[0] === 'citizens_charter_service') {
      return { rows: [{ structured_payload: { id: 'fresh-service' } }] };
    }
    if (sqlIncludes(text, 'FROM content_items ci') && params[0] === 'faq') {
      return { rows: [{ structured_payload: { question: 'Fresh FAQ', answer: 'Published.' } }] };
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
    assert.equal(response.headers.get('location'), '/admin/reviews?notice=approved');
    assert.deepEqual(versionUpdateParams, [55, 10]);
    assert.deepEqual(itemUpdateParams, [90, 55]);
    assert.equal(await redis.get('published:services'), JSON.stringify([{ id: 'fresh-service' }]));
    assert.equal(await redis.get('published:faqs'), JSON.stringify([{ question: 'Fresh FAQ', answer: 'Published.' }]));
    assert.deepEqual(redis.delCalls, ['published:services', 'published:faqs']);
  } finally {
    await close(server);
  }
});

test('content review action notices are shown after redirects', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(async (text) => {
    if (sqlIncludes(text, 'FROM content_versions cv') && sqlIncludes(text, "cv.status = 'pending_review'")) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/reviews?notice=approved`, {
      headers: { cookie },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Content approved and published/);
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
    assert.equal(response.headers.get('location'), '/admin/reviews/55?notice=needs_revision');
    assert.deepEqual(versionUpdateParams, [55, 'needs_revision', 10]);
    assert.deepEqual(noteParams, [55, 10, 'needs_revision', 'Please add processing time and requirements.']);
  } finally {
    await close(server);
  }
});
