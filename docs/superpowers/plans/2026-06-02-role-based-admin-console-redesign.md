# Role-Based Admin Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the AiCO server-rendered admin portal into a role-aware operations console with grouped navigation, badges, avatars, actionable dashboards, clearer forms, review decision panels, and an admin cache refresh action.

**Architecture:** Keep the current Node/server-rendered architecture. Expand `src/layout.js` into a stronger shared HTML/CSS component layer, then update `src/adminRoutes.js` render functions and route handlers to feed counts, actions, and improved markup into that layout.

**Tech Stack:** Node.js 24, CommonJS modules, native `node:test`, PostgreSQL query abstraction through injected pools, Redis through injected client, server-rendered HTML/CSS strings.

---

## File Structure

- Modify `src/layout.js`: role-aware grouped navigation, nav badge rendering, initials avatar helper, enhanced shell CSS, status badges, cards, decision panels, upload zone styling, and optional topbar actions.
- Modify `src/adminRoutes.js`: pass admin counts into layout, render redesigned dashboards/forms/tables/details, add admin-only cache refresh route, and reuse cache invalidation helper.
- Modify `test/httpUtils.test.js`: add layout-level tests for grouped nav, nav badges, initials avatars, deep forest sidebar token, and optional topbar actions.
- Modify `test/adminRoutes.test.js`: add route-level tests for nav count badges, clickable stat cards, account request avatars, upload zone hints, three-column review actions, and admin-only cache refresh.
- No new dependencies.

## Task 1: Layout Shell Primitives

**Files:**

- Modify: `src/layout.js`
- Test: `test/httpUtils.test.js`

- [ ] **Step 1: Write failing layout tests**

Add these tests to `test/httpUtils.test.js` after the existing `pageLayout shows admin navigation` test:

```js
test('pageLayout renders grouped admin navigation with badge counts', () => {
  const html = pageLayout({
    title: 'Admin dashboard',
    activePath: '/admin',
    user: { role: 'admin', name: 'Bootstrap Admin' },
    navCounts: {
      pendingAccountRequests: 4,
      pendingContentReviews: 7,
    },
    body: '<main></main>',
  });

  assert.match(html, /nav-group-label">Overview/);
  assert.match(html, /nav-group-label">Manage/);
  assert.match(html, /href="\/admin\/account-requests"[\s\S]*nav-badge">4<\/span>/);
  assert.match(html, /href="\/admin\/reviews"[\s\S]*nav-badge">7<\/span>/);
});

test('pageLayout renders initials avatar and deep forest sidebar styling', () => {
  const html = pageLayout({
    title: 'Dashboard',
    user: { role: 'office_user', name: 'Office Editor' },
    body: '<p>Welcome</p>',
  });

  assert.match(html, /--slsu-green: #022519/);
  assert.match(html, /repeating-linear-gradient/);
  assert.match(html, /session-avatar" aria-hidden="true">OE<\/span>/);
});

test('pageLayout renders optional topbar actions', () => {
  const html = pageLayout({
    title: 'Admin dashboard',
    user: { role: 'admin', name: 'Bootstrap Admin' },
    topbarActions:
      '<form method="post" action="/admin/cache/refresh"><button type="submit">Refresh cache</button></form>',
    body: '<p>Welcome</p>',
  });

  assert.match(html, /topbar-actions/);
  assert.match(html, /action="\/admin\/cache\/refresh"/);
  assert.match(html, /Refresh cache/);
});

test('pageLayout keeps admin and office navigation separated', () => {
  const adminHtml = pageLayout({
    title: 'Admin dashboard',
    user: { role: 'admin', name: 'Bootstrap Admin' },
    body: '<p>Admin</p>',
  });
  const officeHtml = pageLayout({
    title: 'Office dashboard',
    user: { role: 'office_user', name: 'Office Editor' },
    body: '<p>Office</p>',
  });

  assert.match(adminHtml, /href="\/admin\/account-requests"/);
  assert.match(adminHtml, /href="\/admin\/reviews"/);
  assert.doesNotMatch(adminHtml, /href="\/admin\/content\/new"/);
  assert.match(officeHtml, /href="\/admin\/content\/new"/);
  assert.match(officeHtml, /href="\/admin\/submissions"/);
  assert.doesNotMatch(officeHtml, /href="\/admin\/account-requests"/);
  assert.doesNotMatch(officeHtml, /href="\/admin\/reviews"/);
});
```

- [ ] **Step 2: Run layout tests to verify failure**

Run:

```powershell
rtk npm test -- test/httpUtils.test.js
```

Expected: the new tests fail because `navCounts`, grouped labels, `session-avatar`, `#022519`, and `topbarActions` are not implemented.

- [ ] **Step 3: Implement layout primitives**

In `src/layout.js`, replace the flat `navByRole` arrays with grouped navigation:

```js
const navByRole = {
  anonymous: [
    {
      label: 'Access',
      items: [
        { href: '/login', label: 'Sign in' },
        { href: '/request-account', label: 'Request account' },
      ],
    },
  ],
  admin: [
    {
      label: 'Overview',
      items: [{ href: '/admin', label: 'Dashboard' }],
    },
    {
      label: 'Manage',
      items: [
        {
          href: '/admin/account-requests',
          label: 'Account requests',
          countKey: 'pendingAccountRequests',
        },
        { href: '/admin/reviews', label: 'Content reviews', countKey: 'pendingContentReviews' },
      ],
    },
  ],
  office_user: [
    {
      label: 'Overview',
      items: [{ href: '/admin', label: 'Dashboard' }],
    },
    {
      label: 'Submit',
      items: [
        { href: '/admin/content/new', label: 'New content' },
        { href: '/admin/submissions', label: 'Submissions' },
      ],
    },
  ],
};
```

Add helper functions below `isActive`:

```js
function initialsFor(value) {
  const words = String(value || 'Public access')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'PA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function formatRole(role) {
  return role.replace('_', ' ');
}
```

Replace `renderNav` with:

```js
function renderNav({ user, activePath = '', navCounts = {} }) {
  const role = getRole(user);
  const groups = navByRole[role];

  return groups
    .map((group) => {
      const items = group.items
        .map((item) => {
          const active = isActive(activePath, item.href);
          const current = active ? ' aria-current="page"' : '';
          const className = active ? ' class="nav-link is-active"' : ' class="nav-link"';
          const rawCount = item.countKey ? Number(navCounts[item.countKey] || 0) : 0;
          const badge =
            rawCount > 0 ? `<span class="nav-badge">${escapeHtml(rawCount)}</span>` : '';
          return `<a${className}${current} href="${escapeHtml(item.href)}"><span>${escapeHtml(item.label)}</span>${badge}</a>`;
        })
        .join('');

      return `<div class="nav-group"><p class="nav-group-label">${escapeHtml(group.label)}</p>${items}</div>`;
    })
    .join('');
}
```

Update `pageLayout` signature and session/topbar rendering:

```js
function pageLayout({
  title,
  body,
  user = null,
  activePath = '',
  notice = '',
  navCounts = {},
  topbarActions = '',
  subtitle = '',
}) {
```

Use:

```js
const nav = renderNav({ user, activePath, navCounts });
const displayName = user?.name || user?.full_name || user?.email || 'Public access';
const safeUserName = escapeHtml(displayName);
const safeSubtitle = escapeHtml(subtitle);
const avatar = escapeHtml(initialsFor(displayName));
const sessionSummary = user
  ? `<div class="session-user"><span class="session-avatar" aria-hidden="true">${avatar}</span><p>${safeUserName}<span>${escapeHtml(formatRole(role))}</span></p></div>`
  : `<div class="session-user"><span class="session-avatar" aria-hidden="true">PA</span><p>Public access<span>Account portal</span></p></div>`;
```

In the topbar markup, render a header text block and action slot:

```html
<header class="topbar">
  <div class="topbar-title">
    <h1>${safeTitle}</h1>
    ${safeSubtitle ? `
    <p>${safeSubtitle}</p>
    ` : ''}
  </div>
  <div class="topbar-actions">
    ${topbarActions || '<span class="status-pill">Chatbot status</span>'}
  </div>
</header>
```

Update CSS in `src/layout.js` to include these selectors and tokens:

```css
:root {
  --slsu-green: #022519;
  --slsu-green-strong: #01180f;
  --slsu-gold: #c89b2c;
  --aico-blue: #1f6fbf;
  --aico-red: #b42318;
  --aico-success: #187447;
  --aico-warning: #a15c07;
  --ink: #17211d;
  --muted: #5f6f68;
  --line: #dbe4df;
  --surface: #ffffff;
  --workspace: #f3f7f4;
  --radius: 8px;
}

.sidebar {
  color: #fff;
  background:
    repeating-linear-gradient(135deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 11px),
    var(--slsu-green);
  border-right: 4px solid var(--slsu-gold);
  padding: 20px 16px;
}

.session-user {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
  padding: 10px;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: var(--radius);
  background: var(--slsu-green-strong);
}

.session-user p {
  margin: 0;
  min-width: 0;
  font-weight: 700;
}

.session-avatar {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--slsu-green);
  background: var(--slsu-gold);
  font-size: 13px;
  font-weight: 800;
}

.nav-group {
  display: grid;
  gap: 6px;
}

.nav-group + .nav-group {
  margin-top: 18px;
}

.nav-group-label {
  margin: 0 0 2px;
  color: rgb(255 255 255 / 58%);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 9px 10px;
  border-left: 4px solid transparent;
  border-radius: var(--radius);
  color: rgb(255 255 255 / 88%);
  text-decoration: none;
}

.nav-badge {
  min-width: 22px;
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--slsu-green);
  background: var(--slsu-gold);
  font-size: 12px;
  font-weight: 800;
  text-align: center;
}

.topbar-title {
  display: grid;
  gap: 3px;
}

.topbar-title p {
  margin: 0;
  color: var(--muted);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 4: Run layout tests to verify pass**

Run:

```powershell
rtk npm test -- test/httpUtils.test.js
```

Expected: all tests in `test/httpUtils.test.js` pass.

- [ ] **Step 5: Commit layout primitives**

Run:

```powershell
rtk git add src/layout.js test/httpUtils.test.js
rtk git commit -m "Improve role-based admin shell layout"
```

## Task 2: Admin Dashboard Counts And Cache Refresh

**Files:**

- Modify: `src/adminRoutes.js`
- Test: `test/adminRoutes.test.js`

- [ ] **Step 1: Write failing admin dashboard and cache tests**

Add this assertion block to the existing `admin dashboard shows pending account, pending review, and published counts` test after the published count assertion:

```js
assert.match(html, /href="\/admin\/account-requests"[\s\S]*nav-badge">4<\/span>/);
assert.match(html, /href="\/admin\/reviews"[\s\S]*nav-badge">7<\/span>/);
assert.match(html, /href="\/admin\/account-requests" class="metric-card/);
assert.match(html, /href="\/admin\/reviews" class="metric-card/);
assert.match(html, /action="\/admin\/cache\/refresh"/);
assert.match(html, /Refresh cache/);
```

Add these new tests near the content approval cache test:

```js
test('admin can manually refresh published chatbot cache', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  await redis.set('published:services', 'cached services');
  await redis.set('published:faqs', 'cached faqs');
  const pool = createFakePool(() => {
    throw new Error('cache refresh should not query the database');
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
    assert.deepEqual(redis.delCalls, ['published:services', 'published:faqs']);
  } finally {
    await close(server);
  }
});

test('office users cannot manually refresh published chatbot cache', async () => {
  const redis = new FakeRedis();
  const cookie = await officeCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('cache refresh should not query the database');
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
    assert.match(html, /You do not have access to this page/);
    assert.deepEqual(redis.delCalls, []);
  } finally {
    await close(server);
  }
});

test('cache refresh only allows POST', async () => {
  const redis = new FakeRedis();
  const cookie = await adminCookie(redis);
  const pool = createFakePool(() => {
    throw new Error('cache refresh method check should not query the database');
  });
  const server = createAdminServer({ pool, redis });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/admin/cache/refresh`, {
      headers: { cookie },
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.deepEqual(redis.delCalls, []);
  } finally {
    await close(server);
  }
});
```

- [ ] **Step 2: Run admin route tests to verify failure**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: dashboard assertions fail because cards/nav counts/cache action are missing, and the cache route returns 404.

- [ ] **Step 3: Implement dashboard counts and cache route**

In `src/adminRoutes.js`, add helpers near `renderAdminDashboard`:

```js
function adminNavCounts(counts) {
  return {
    pendingAccountRequests: Number(counts.pending_account_requests || 0),
    pendingContentReviews: Number(counts.pending_content_reviews || 0),
  };
}

function renderRefreshCacheAction() {
  return `
    <form method="post" action="/admin/cache/refresh">
      <button class="button button-secondary" type="submit">Refresh cache</button>
    </form>
  `;
}
```

Replace `renderAdminDashboard` body with linked metric cards:

```js
function renderAdminDashboard(user, counts, notice = '') {
  const safeCounts = {
    pendingAccountRequests: Number(counts.pending_account_requests || 0),
    pendingContentReviews: Number(counts.pending_content_reviews || 0),
    publishedRecords: Number(counts.published_records || 0),
  };

  return pageLayout({
    title: 'Admin dashboard',
    subtitle: 'Review account access, content queues, and chatbot-ready records.',
    activePath: '/admin',
    user,
    notice,
    navCounts: adminNavCounts(counts),
    topbarActions: renderRefreshCacheAction(),
    body: `
      <section class="metric-grid" aria-label="Administrative counts">
        <a class="metric-card" href="/admin/account-requests">
          <span>Pending account requests</span>
          <strong>${escapeHtml(safeCounts.pendingAccountRequests)}</strong>
          <em>Review requests</em>
        </a>
        <a class="metric-card" href="/admin/reviews">
          <span>Pending content reviews</span>
          <strong>${escapeHtml(safeCounts.pendingContentReviews)}</strong>
          <em>Review content</em>
        </a>
        <div class="metric-card">
          <span>Published records</span>
          <strong>${escapeHtml(safeCounts.publishedRecords)}</strong>
          <em>Available to the chatbot</em>
        </div>
      </section>
    `,
  });
}
```

Update `handleDashboard` so the admin path passes notices:

```js
const notice =
  url?.searchParams?.get('cache_refreshed') === '1'
    ? 'Published chatbot cache has been refreshed.'
    : '';
sendHtml(response, 200, renderAdminDashboard(user, result.rows[0] || {}, notice));
```

Change the function signature to:

```js
async function handleDashboard({ response, pool, user, url }) {
```

Update its caller:

```js
await handleDashboard({ response, pool: services.pool, user, url });
```

Add a route before `/admin/attachments`:

```js
if (pathname === '/admin/cache/refresh') {
  const user = await requireReviewAdmin({ request, response, redis: services.redis });
  if (!user) return true;

  if (request.method !== 'POST') {
    methodNotAllowed(response, ['POST']);
    return true;
  }

  await invalidatePublishedCache(services.redis);
  redirect(response, '/admin?cache_refreshed=1');
  return true;
}
```

- [ ] **Step 4: Run admin route tests to verify pass**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: all tests in `test/adminRoutes.test.js` pass.

- [ ] **Step 5: Commit dashboard and cache route**

Run:

```powershell
rtk git add src/adminRoutes.js test/adminRoutes.test.js
rtk git commit -m "Add admin dashboard nav counts and cache refresh"
```

## Task 3: Shared Visual Components And Status Badges

**Files:**

- Modify: `src/adminRoutes.js`
- Modify: `src/layout.js`
- Test: `test/adminRoutes.test.js`

- [ ] **Step 1: Write failing status/avatar assertions**

In the existing `office dashboard shows submissions with status and latest admin note` test, replace the plain status assertion:

```js
assert.match(html, /needs revision/);
```

with:

```js
assert.match(html, /status-badge status-needs-revision/);
assert.match(html, /<span class="status-dot" aria-hidden="true"><\/span>Needs revision/);
```

In the account requests index test, or create one if it does not exist, assert:

```js
assert.match(html, /person-avatar" aria-hidden="true">MS<\/span>/);
assert.match(html, /Maria Santos/);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: status badge and person avatar assertions fail.

- [ ] **Step 3: Add admin route helpers**

In `src/adminRoutes.js`, add helpers near `formatStatus`:

```js
function initialsFor(value) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '--';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function statusClass(status) {
  const normalized = clean(status).replace(/_/g, '-').toLowerCase();
  return normalized || 'unknown';
}

function renderStatusBadge(status) {
  const label = formatStatus(status);
  return `<span class="status-badge status-${escapeHtml(statusClass(status))}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function renderPersonName(name, detail = '') {
  return `
    <div class="person-cell">
      <span class="person-avatar" aria-hidden="true">${escapeHtml(initialsFor(name))}</span>
      <span><strong>${escapeHtml(name)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>
    </div>
  `;
}
```

Update `renderOfficeSubmissionRows` status cell:

```js
<td>${renderStatusBadge(submission.status)}</td>
```

Update `renderAccountRequestRows` name cell:

```js
<td>${renderPersonName(request.full_name, request.email)}</td>
```

- [ ] **Step 4: Add CSS for badges and people**

In `src/layout.js` CSS, add:

```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--ink);
  background: #f8fbf9;
  font-size: 13px;
  font-weight: 700;
  text-transform: capitalize;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}

.status-pending-review .status-dot,
.status-pending .status-dot {
  background: var(--aico-blue);
}

.status-needs-revision .status-dot,
.status-needs-info .status-dot {
  background: var(--aico-warning);
}

.status-published .status-dot,
.status-approved .status-dot {
  background: var(--aico-success);
}

.status-rejected .status-dot {
  background: var(--aico-red);
}

.person-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.person-avatar {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--slsu-green);
  background: #e8f0eb;
  font-size: 12px;
  font-weight: 800;
}

.person-cell small {
  display: block;
  margin-top: 1px;
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js test/httpUtils.test.js
```

Expected: both test files pass.

- [ ] **Step 6: Commit shared visual components**

Run:

```powershell
rtk git add src/adminRoutes.js src/layout.js test/adminRoutes.test.js
rtk git commit -m "Add status badges and people avatars"
```

## Task 4: Office Content Form Upload Zone And Sections

**Files:**

- Modify: `src/adminRoutes.js`
- Modify: `src/layout.js`
- Test: `test/adminRoutes.test.js`

- [ ] **Step 1: Write failing upload-zone test assertions**

In `renders new content form only for authenticated office users`, add:

```js
assert.match(html, /form-section/);
assert.match(html, /Content basics/);
assert.match(html, /Service details/);
assert.match(html, /upload-zone/);
assert.match(html, /PDF, PNG, JPG, JPEG, or DOCX/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: new content form assertions fail.

- [ ] **Step 3: Update new content form markup**

Replace the body inside `renderNewContentForm` with:

```js
body: `
  <form class="form-stack" method="post" action="/admin/content" enctype="multipart/form-data">
    <input name="office_id" type="hidden" value="${escapeHtml(user.office_id)}">
    <section class="form-section">
      <div class="section-heading">
        <h2>Content basics</h2>
        <p>Choose the record type and provide the title shown to reviewers.</p>
      </div>
      <label>Content type
        <select id="content_type" name="content_type" required>
          ${contentTypeOptions()}
        </select>
      </label>
      ${field('Title', 'title', { required: true })}
      ${field('Body', 'body', { multiline: true, required: true })}
    </section>
    <section class="form-section">
      <div class="section-heading">
        <h2>Service details</h2>
        <p>Use these fields for Citizen's Charter records and leave unrelated fields blank for other content types.</p>
      </div>
      ${field('Requirements', 'requirements', { multiline: true })}
      ${field('Procedure', 'procedure', { multiline: true })}
      <div class="field-grid">
        ${field('Fees', 'fees')}
        ${field('Processing time', 'processing_time')}
      </div>
    </section>
    <section class="form-section">
      <div class="section-heading">
        <h2>Supporting file</h2>
        <p>Attach official references that help reviewers verify the update.</p>
      </div>
      <label class="upload-zone">Supporting file
        <span>Drop a file here or choose from your device.</span>
        <small>PDF, PNG, JPG, JPEG, or DOCX</small>
        <input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
      </label>
    </section>
    <div class="form-actions">
      <button type="submit">Submit for review</button>
    </div>
  </form>
`,
```

- [ ] **Step 4: Add form section and upload CSS**

In `src/layout.js` CSS, add:

```css
.form-stack {
  display: grid;
  gap: 18px;
}

.form-section {
  display: grid;
  gap: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px;
  background: #fff;
}

.section-heading {
  display: grid;
  gap: 4px;
}

.section-heading h2 {
  margin: 0;
  font-size: 18px;
}

.section-heading p {
  margin: 0;
  color: var(--muted);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.upload-zone {
  display: grid;
  gap: 6px;
  border: 1px dashed #9db6aa;
  border-radius: var(--radius);
  padding: 18px;
  background: #f8fbf9;
  cursor: pointer;
}

.upload-zone span {
  color: var(--ink);
  font-weight: 700;
}

.upload-zone small {
  color: var(--muted);
}

.upload-zone input {
  margin-top: 8px;
  background: #fff;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: all admin route tests pass.

- [ ] **Step 6: Commit form redesign**

Run:

```powershell
rtk git add src/adminRoutes.js src/layout.js test/adminRoutes.test.js
rtk git commit -m "Redesign office content form"
```

## Task 5: Content Review Workspace Actions

**Files:**

- Modify: `src/adminRoutes.js`
- Modify: `src/layout.js`
- Test: `test/adminRoutes.test.js`

- [ ] **Step 1: Write failing review detail assertions**

In the existing content review detail render test, add these assertions after checking the submitted title/body:

```js
assert.match(html, /review-workspace/);
assert.match(html, /decision-grid/);
assert.match(html, /decision-card decision-approve/);
assert.match(html, /Approve and publish/);
assert.match(html, /decision-card decision-revise/);
assert.match(html, /Needs revision/);
assert.match(html, /decision-card decision-reject/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js
```

Expected: review workspace assertions fail.

- [ ] **Step 3: Update review detail markup**

Replace `renderContentReviewDetail` body with:

```js
body: `
  <div class="review-workspace">
    <section class="review-main">
      <div class="detail-header">
        <p>${escapeHtml(CONTENT_TYPE_LABELS[review.content_type] || review.content_type)} from ${escapeHtml(review.office_name || '')}</p>
        <h2>${escapeHtml(review.title)}</h2>
        ${renderStatusBadge(review.status)}
      </div>
      <section class="form-section">
        <div class="section-heading">
          <h2>Submitted content</h2>
          <p>Review this version before approving it for chatbot answers.</p>
        </div>
        <p>${escapeHtml(review.body || '')}</p>
      </section>
      <section class="form-section">
        <div class="section-heading">
          <h2>Structured payload</h2>
          <p>Raw fields captured for publishing and chatbot lookup.</p>
        </div>
        <pre>${escapeHtml(payload)}</pre>
      </section>
    </section>
    <aside class="decision-panel" aria-label="Review actions">
      <div class="decision-grid">
        <form class="decision-card decision-approve" method="post" action="/admin/reviews/${escapeHtml(review.id)}/approve">
          <h2>Approve</h2>
          <p>Publish this version and make it available to chatbot answers.</p>
          <button type="submit">Approve and publish</button>
        </form>
        <form class="decision-card decision-revise" method="post" action="/admin/reviews/${escapeHtml(review.id)}/needs-revision">
          <h2>Request revision</h2>
          <p>Return this submission to the office with instructions.</p>
          <textarea name="note" placeholder="Review note" required></textarea>
          <button class="button-secondary" type="submit">Needs revision</button>
        </form>
        <form class="decision-card decision-reject" method="post" action="/admin/reviews/${escapeHtml(review.id)}/reject">
          <h2>Reject</h2>
          <p>Reject this version without changing published chatbot content.</p>
          <textarea name="note" placeholder="Review note" required></textarea>
          <button class="button-danger" type="submit">Reject</button>
        </form>
      </div>
    </aside>
  </div>
`,
```

Pass `subtitle` into the page layout:

```js
subtitle: 'Approve, request revision, or reject submitted office content.',
```

- [ ] **Step 4: Add review workspace CSS**

In `src/layout.js` CSS, add:

```css
.review-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}

.review-main {
  display: grid;
  gap: 18px;
}

.detail-header {
  display: grid;
  gap: 8px;
}

.detail-header p,
.detail-header h2 {
  margin: 0;
}

.decision-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.decision-card {
  display: grid;
  align-content: start;
  gap: 10px;
  border: 1px solid var(--line);
  border-top: 4px solid var(--aico-blue);
  border-radius: var(--radius);
  padding: 14px;
  background: #fff;
}

.decision-card h2,
.decision-card p {
  margin: 0;
}

.decision-card p {
  color: var(--muted);
}

.decision-approve {
  border-top-color: var(--aico-success);
}

.decision-revise {
  border-top-color: var(--aico-warning);
}

.decision-reject {
  border-top-color: var(--aico-red);
}

@media (max-width: 980px) {
  .decision-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
rtk npm test -- test/adminRoutes.test.js test/httpUtils.test.js
```

Expected: both test files pass.

- [ ] **Step 6: Commit review workspace**

Run:

```powershell
rtk git add src/adminRoutes.js src/layout.js test/adminRoutes.test.js
rtk git commit -m "Redesign content review workspace"
```

## Task 6: Final Integration And Full Verification

**Files:**

- Modify: files changed by formatting or test fixes only
- Test: full test suite

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
rtk npm test
```

Expected: all tests pass.

- [ ] **Step 2: Inspect final diff**

Run:

```powershell
rtk git status --short
rtk git diff -- src/layout.js src/adminRoutes.js test/httpUtils.test.js test/adminRoutes.test.js
```

Expected: no unstaged changes if each task committed. If a small verification fix was needed, the diff only contains that fix.

- [ ] **Step 3: Start local server for manual UI verification**

Run:

```powershell
rtk npm run start
```

Expected: the app starts on the configured `PORT` or default port `3000`. If local PostgreSQL or Redis is not available, record that browser verification is blocked by missing services and rely on route tests for this pass.

- [ ] **Step 4: Manual browser checklist**

Check these pages when local services are available:

```text
/login
/request-account
/admin as admin
/admin/account-requests as admin
/admin/reviews as admin
/admin/reviews/:id as admin with a pending review id
/admin/content/new as office_user
```

Expected visual checks:

```text
Sidebar is deep forest green with subtle texture.
Navigation groups are visible and scannable.
Admin nav badges show pending account and content review counts.
Session summary uses initials avatar.
Dashboard stat cards are clickable.
Account request names include initials avatars.
Office submission statuses use colored-dot badges.
Content form uses grouped sections and upload-zone styling.
Review detail actions appear in three columns on desktop and stack on smaller widths.
Refresh cache appears only for admin pages that pass topbarActions.
```

- [ ] **Step 5: Commit final verification fix if needed**

If Step 2 showed a small fix, run:

```powershell
rtk git add src/layout.js src/adminRoutes.js test/httpUtils.test.js test/adminRoutes.test.js
rtk git commit -m "Polish admin console verification issues"
```

Expected: working tree is clean or contains only user-owned unrelated changes.

## Self-Review Notes

- Spec coverage: tasks cover the textured sidebar, grouped nav labels, nav badges, initials avatars, role-separated navigation, clickable dashboard stat cards, status-dot badges, upload zone, review decision panels, cache refresh route, route-level tests, and full verification.
- Intentional staging: user management, office management, content inventory, drafts, revision resubmission, audit views, and attachment management remain IA/spec commitments because the database-backed routes are not currently implemented.
- Type consistency: `navCounts.pendingAccountRequests`, `navCounts.pendingContentReviews`, `renderStatusBadge`, `renderPersonName`, `renderRefreshCacheAction`, and `adminNavCounts` names are used consistently across tasks.
