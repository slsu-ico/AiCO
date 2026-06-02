const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  escapeHtml,
  parseUrlEncoded,
  readBody,
  sendHtml,
  redirect,
  notFound,
  methodNotAllowed,
} = require('../src/httpUtils');
const { pageLayout } = require('../src/layout');

function createRequest(chunks = []) {
  const request = new EventEmitter();
  process.nextTick(() => {
    for (const chunk of chunks) request.emit('data', Buffer.from(chunk));
    request.emit('end');
  });
  return request;
}

function createResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

test('escapeHtml escapes text that can break out of HTML', () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>&'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('parseUrlEncoded parses form bodies and preserves repeated fields', () => {
  assert.deepEqual(parseUrlEncoded('name=AiCO+Admin&office=SLSU%20ICO&tag=one&tag=two'), {
    name: 'AiCO Admin',
    office: 'SLSU ICO',
    tag: ['one', 'two'],
  });
});

test('readBody collects request chunks as utf8 text', async () => {
  assert.equal(await readBody(createRequest(['first ', 'second'])), 'first second');
});

test('response helpers write expected status codes and headers', () => {
  const html = createResponse();
  sendHtml(html, 201, '<main>AiCO</main>');
  assert.equal(html.statusCode, 201);
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(html.body, '<main>AiCO</main>');

  const redirected = createResponse();
  redirect(redirected, '/login');
  assert.equal(redirected.statusCode, 303);
  assert.equal(redirected.headers.location, '/login');

  const missing = createResponse();
  notFound(missing);
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body, /Not Found/);

  const blocked = createResponse();
  methodNotAllowed(blocked, ['GET', 'POST']);
  assert.equal(blocked.statusCode, 405);
  assert.equal(blocked.headers.allow, 'GET, POST');
});

test('pageLayout includes SLSU and AiCO Admin branding', () => {
  const html = pageLayout({ title: 'Dashboard', body: '<p>Welcome</p>' });
  assert.match(html, /Southern Luzon State University/);
  assert.match(html, /AiCO Admin/);
});

test('pageLayout shows anonymous navigation without authenticated admin links', () => {
  const html = pageLayout({ title: 'Login', activePath: '/login', body: '<form></form>' });
  assert.match(html, /href="\/login"/);
  assert.match(html, /href="\/request-account"/);
  assert.doesNotMatch(html, /href="\/admin\/account-requests"/);
  assert.doesNotMatch(html, /href="\/admin\/content\/new"/);
});

test('pageLayout shows admin navigation', () => {
  const html = pageLayout({
    title: 'Account Requests',
    activePath: '/admin/account-requests',
    user: { role: 'admin', name: 'Registrar' },
    body: '<table></table>',
  });

  assert.match(html, /href="\/admin"/);
  assert.match(html, /href="\/admin\/account-requests"/);
  assert.match(html, /href="\/admin\/reviews"/);
  assert.doesNotMatch(html, /href="\/admin\/content\/new"/);
  assert.doesNotMatch(html, /href="\/admin\/submissions"/);
});

test('pageLayout shows office user navigation', () => {
  const html = pageLayout({
    title: 'Content',
    activePath: '/admin/content/new',
    user: { role: 'office_user', name: 'ICO Office' },
    body: '<table></table>',
  });

  assert.match(html, /href="\/admin"/);
  assert.match(html, /href="\/admin\/content\/new"/);
  assert.match(html, /href="\/admin\/submissions"/);
  assert.doesNotMatch(html, /href="\/admin\/account-requests"/);
  assert.doesNotMatch(html, /href="\/admin\/reviews"/);
});

test('pageLayout keeps anonymous users out of role-only navigation', () => {
  const html = pageLayout({ title: 'Login', activePath: '/login', body: '<form></form>' });

  assert.doesNotMatch(html, /href="\/admin"/);
  assert.doesNotMatch(html, /href="\/admin\/account-requests"/);
  assert.doesNotMatch(html, /href="\/admin\/reviews"/);
  assert.doesNotMatch(html, /href="\/admin\/content\/new"/);
  assert.doesNotMatch(html, /href="\/admin\/submissions"/);
});

test('pageLayout marks active nav and escapes title and notice while allowing trusted body html', () => {
  const html = pageLayout({
    title: '<Dashboard>',
    activePath: '/admin',
    notice: '<Saved & ready>',
    user: { role: 'admin', name: '<Admin>' },
    body: '<section data-testid="trusted-body"><strong>Allowed</strong></section>',
  });

  assert.match(html, /<title>&lt;Dashboard&gt; - AiCO Admin<\/title>/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /&lt;Saved &amp; ready&gt;/);
  assert.match(html, /&lt;Admin&gt;/);
  assert.match(html, /<section data-testid="trusted-body"><strong>Allowed<\/strong><\/section>/);
});
