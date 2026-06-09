# AiCO Demo Dashboard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the `aico_demo_v3.html` admin dashboard layout and chatbot simulator into the existing AiCO server-rendered app.

**Architecture:** Keep the Node/CommonJS server-rendered architecture. Extend shared layout markup/styles in `src/layout.js`, add a server-rendered chatbot demo view in `src/adminViews.js`, and route `/admin/chatbot-demo` through `src/adminRoutes.js` behind existing authenticated admin access.

**Tech Stack:** Node.js, CommonJS, native `node:test`, server-rendered HTML/CSS/JavaScript.

---

## File Structure

- Modify `src/layout.js`: grouped nav metadata, demo-inspired app shell CSS, page subtitle/action support, compact table/form/status styles, and chatbot demo JavaScript hooks.
- Modify `src/adminViews.js`: dashboard metric tiles, status badge helper, chatbot demo renderer, and richer page layout options.
- Modify `src/adminRoutes.js`: import and serve `renderChatbotDemo` from `/admin/chatbot-demo`.
- Modify `test/layout.test.js`: assert shell/nav structure and new demo link.
- Modify `test/adminViews.test.js`: assert dashboard tiles and chatbot demo markup escape/static structure.
- Modify `test/adminRoutes.test.js`: assert authenticated users can open `/admin/chatbot-demo`.

---

### Task 1: Add Failing View Tests

**Files:**
- Modify: `test/adminViews.test.js`
- Modify: `test/layout.test.js`

- [ ] **Step 1: Add tests for dashboard tiles and chatbot demo**

Append tests that import `renderAdminDashboard` and `renderChatbotDemo`, then assert:

```js
assert.match(html, /class="metric-grid"/);
assert.match(html, /Pending account requests/);
assert.match(html, /href="\/admin\/account-requests"/);
assert.match(html, /class="chat-demo-shell"/);
assert.match(html, /id="chat-demo-messages"/);
assert.doesNotMatch(html, /<script>alert/);
```

- [ ] **Step 2: Add layout test expectations**

Update `test/layout.test.js` to assert:

```js
assert.match(html, /class="nav-group-label"/);
assert.match(html, /href="\/admin\/chatbot-demo"/);
assert.match(html, /class="sidebar-user-avatar"/);
```

- [ ] **Step 3: Run failing view tests**

Run: `rtk node --test test/adminViews.test.js test/layout.test.js`

Expected: FAIL because `renderChatbotDemo`, `metric-grid`, grouped labels, and the demo link do not exist yet.

---

### Task 2: Implement Shared Shell And Dashboard Markup

**Files:**
- Modify: `src/layout.js`
- Modify: `src/adminViews.js`

- [ ] **Step 1: Update `src/layout.js`**

Change nav metadata to grouped items, add `/admin/chatbot-demo`, render group labels, render compact user avatar details, and replace the CSS with the demo-inspired shell while preserving the same skip link, `main#main-content`, forms, tables, modals, and responsive behavior.

- [ ] **Step 2: Update `renderAdminDashboard`**

Replace the plain count table with:

```html
<div class="metric-grid">
  <a class="metric-card" href="/admin/account-requests">...</a>
  <a class="metric-card" href="/admin/reviews">...</a>
  <form class="metric-card metric-card-form" method="post" action="/admin/cache/refresh">...</form>
</div>
<section class="panel-section">...</section>
```

Keep the CSRF token in the refresh form and keep the existing labels used by route tests.

- [ ] **Step 3: Run targeted tests**

Run: `rtk node --test test/adminViews.test.js test/layout.test.js`

Expected: dashboard/layout assertions pass; chatbot demo assertions still fail until Task 3.

---

### Task 3: Add Chatbot Demo View And Route

**Files:**
- Modify: `src/adminViews.js`
- Modify: `src/adminRoutes.js`
- Modify: `test/adminRoutes.test.js`

- [ ] **Step 1: Add failing route test**

Add a route test that authenticates with `adminCookie`, fetches `/admin/chatbot-demo`, and asserts status `200`, `AiCO chatbot demo`, `chat-demo-shell`, and no admin-only database query is required.

- [ ] **Step 2: Implement `renderChatbotDemo`**

Add a server-rendered view with:

```html
<section class="chat-demo-shell" aria-label="AiCO chatbot demo">
  <div class="chat-demo-header">...</div>
  <div class="chat-demo-messages" id="chat-demo-messages"></div>
  <div class="quick-replies" id="chat-demo-quick-replies"></div>
  <form class="chat-demo-input" id="chat-demo-form">...</form>
</section>
<script>...</script>
```

Use static canned replies, no user-provided server data in JavaScript, and no network calls.

- [ ] **Step 3: Add route**

Import `renderChatbotDemo` and serve it at `GET /admin/chatbot-demo` after `requireAdmin`. Return `405` for non-GET methods.

- [ ] **Step 4: Run targeted route/view tests**

Run: `rtk node --test test/adminViews.test.js test/layout.test.js test/adminRoutes.test.js`

Expected: PASS.

---

### Task 4: Polish Existing Admin Surfaces

**Files:**
- Modify: `src/layout.js`
- Modify: `src/adminViews.js`

- [ ] **Step 1: Add compact status badges**

Add helper markup for statuses where it is low risk, especially office submissions and account request rows:

```html
<span class="status-badge status-pending"><span class="status-dot"></span>Pending</span>
```

- [ ] **Step 2: Wrap major surfaces**

Ensure list pages and forms use `panel-section`, `table-scroll`, and existing form classes so the shell, dashboard, filters, modals, and content pages feel consistent.

- [ ] **Step 3: Run full tests**

Run: `rtk corepack pnpm test`

Expected: PASS.

---

## Self-Review

- Spec coverage: the plan covers shell refresh, dashboard metric tiles, existing admin surface styling, chatbot demo route/view, navigation, and tests.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: all named render functions and routes match existing CommonJS patterns.
