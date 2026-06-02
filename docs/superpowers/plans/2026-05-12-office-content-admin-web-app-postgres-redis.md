# Office Content Admin Web App PostgreSQL/Redis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AiCO admin web app with PostgreSQL as the durable database and Redis for sessions, published-content caching, and short-lived workflow state.

**Architecture:** Extend the existing Node.js HTTP server with server-rendered admin pages. Use PostgreSQL for offices, users, account requests, content versions, review notes, and attachment metadata. Use Redis for session storage and cached published chatbot records so pending edits never affect live chatbot answers.

**Tech Stack:** Node.js 24 CommonJS, `pg` for PostgreSQL, `redis` for Redis, built-in `node:test`, built-in `node:crypto`, plain HTML/CSS, local filesystem storage for uploaded files in version one.

---

## Key Decisions

- PostgreSQL replaces the earlier SQLite plan.
- Redis replaces signed cookie-only sessions. Cookies store only an opaque session id.
- The chatbot reads published Citizen's Charter and FAQ records through a repository that prefers Redis cache and falls back to PostgreSQL.
- Content review uses version rows. The current published version remains active until admin approval succeeds.
- Attachments store metadata in PostgreSQL and files in `uploads/` for version one.

## Environment

Required variables:

```text
PORT=3000
MESSENGER_VERIFY_TOKEN=replace-with-meta-verify-token
PAGE_ACCESS_TOKEN=replace-with-page-access-token
DATABASE_URL=postgres://user:password@localhost:5432/aico
REDIS_URL=redis://localhost:6379
UPLOAD_DIR=uploads
SESSION_SECRET=replace-with-long-random-secret
BOOTSTRAP_ADMIN_EMAIL=reports@slsu.edu.ph
BOOTSTRAP_ADMIN_PASSWORD=replace-before-deployment
```

## File Structure

- Create `src/db/postgres.js`: PostgreSQL pool, query helper, transaction helper.
- Create `src/db/schema.sql`: tables, constraints, useful indexes.
- Create `src/db/migrate.js`: runs schema safely.
- Create `src/db/seed.js`: creates ICO office, bootstrap admin, imports `data/services.json`.
- Create `src/cache/redis.js`: Redis client factory and JSON cache helpers.
- Create `src/auth.js`: password hashing, Redis-backed session creation, lookup, logout.
- Create `src/httpUtils.js`: request parsing, redirects, HTML escaping, response helpers.
- Create `src/layout.js`: shared server-rendered page shell.
- Create `src/adminRoutes.js`: account requests, login, dashboards, content submissions, review actions.
- Create `src/publishedContentRepository.js`: published chatbot read path with Redis cache and PostgreSQL fallback.
- Create `src/uploads.js`: validates and stores uploaded files, returns metadata.
- Modify `src/server.js`: wire admin routes and database-backed published chatbot records.
- Modify `src/config.js`: add PostgreSQL, Redis, upload, session, bootstrap admin settings.
- Modify `package.json`: add `pg`, `redis`, `migrate`, and `seed` scripts.
- Modify `.env.example`, `.gitignore`, and `README.md`.

## PostgreSQL Schema

Use `BIGSERIAL` primary keys, `timestamptz`, foreign keys, and status `CHECK` constraints.

Tables:

- `offices`
- `users`
- `account_requests`
- `content_items`
- `content_versions`
- `review_notes`
- `attachments`

Core indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON account_requests(status);
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_content_items_office_type ON content_items(office_id, content_type);
CREATE INDEX IF NOT EXISTS idx_content_versions_status ON content_versions(status);
CREATE INDEX IF NOT EXISTS idx_content_versions_item_status ON content_versions(content_item_id, status);
```

## Redis Usage

Redis keys:

```text
session:<session_id>
published:services
published:faqs
rate:login:<ip>
```

Rules:

- Session values expire after 8 hours.
- Published chatbot cache expires after 10 minutes.
- Any admin approval invalidates `published:services` and `published:faqs`.
- Login rate counters expire after 15 minutes.

## Task 1: Dependencies, Config, And Git Hygiene

**Files:**

- Modify `package.json`
- Modify `src/config.js`
- Modify `.env.example`
- Create `.gitignore`
- Create `uploads/.gitkeep`
- Create `test/config.test.js`

Steps:

- [ ] Add dependencies with `rtk npm install pg redis`.
- [ ] Add scripts:

```json
{
  "migrate": "node src/db/migrate.js",
  "seed": "node src/db/seed.js",
  "test": "node --test"
}
```

- [ ] Update `getConfig()` to return `databaseUrl`, `redisUrl`, `uploadDir`, `sessionSecret`, `bootstrapAdminEmail`, and `bootstrapAdminPassword`.
- [ ] Add `.gitignore` entries for `.env`, `uploads/*`, `!uploads/.gitkeep`, `node_modules/`, `.superpowers/`.
- [ ] Test config defaults and env overrides.
- [ ] Run `rtk npm test`.
- [ ] Commit: `Add PostgreSQL and Redis runtime configuration`.

## Task 2: PostgreSQL Schema And Migration

**Files:**

- Create `src/db/schema.sql`
- Create `src/db/postgres.js`
- Create `src/db/migrate.js`
- Create `test/dbSchema.test.js`

Steps:

- [ ] Implement `createPool(config)` using `pg.Pool`.
- [ ] Implement `query(pool, text, params)` and `withTransaction(pool, callback)`.
- [ ] Write `schema.sql` with all seven tables, constraints, and indexes.
- [ ] Write migration runner that executes `schema.sql`.
- [ ] Test by creating a temporary test database connection from `DATABASE_URL`.
- [ ] Run migration twice to confirm idempotency.
- [ ] Commit: `Add PostgreSQL schema migration`.

## Task 3: Seed Initial Office, Admin, And Charter Services

**Files:**

- Create `src/db/seed.js`
- Create `test/seed.test.js`

Steps:

- [ ] Insert ICO office if missing.
- [ ] Insert bootstrap admin if missing using hashed password.
- [ ] Import `data/services.json` as published `citizens_charter_service` content.
- [ ] Ensure re-running seed does not duplicate services.
- [ ] Test office/admin/service import.
- [ ] Commit: `Seed initial AiCO data`.

## Task 4: Redis Client And Session Authentication

**Files:**

- Create `src/cache/redis.js`
- Create `src/auth.js`
- Create `test/auth.test.js`

Steps:

- [ ] Implement Redis client creation from `REDIS_URL`.
- [ ] Implement `setJson`, `getJson`, and `deleteKey`.
- [ ] Implement password hashing with `crypto.scryptSync`.
- [ ] Implement `createSession(redis, user)` that stores `session:<uuid>` with 8-hour TTL.
- [ ] Implement `getSession(redis, cookieHeader)` and `destroySession(redis, cookieHeader)`.
- [ ] Test password verification and Redis session lifecycle.
- [ ] Commit: `Add Redis backed authentication`.

## Task 5: HTTP Utilities And Shared Layout

**Files:**

- Create `src/httpUtils.js`
- Create `src/layout.js`
- Create `test/httpUtils.test.js`

Steps:

- [ ] Implement HTML escaping, URL-encoded parsing, request body reading, HTML response, redirect, 404, and 405 helpers.
- [ ] Implement page shell with navigation for anonymous, admin, and office users.
- [ ] Test HTML escaping and form parsing.
- [ ] Commit: `Add admin HTTP rendering utilities`.

## Task 6: Login And Account Request Flow

**Files:**

- Create `src/adminRoutes.js`
- Modify `src/server.js`
- Create `test/adminRoutes.test.js`

Steps:

- [ ] Add `GET /login`, `POST /login`, and `GET /logout`.
- [ ] Add `GET /request-account` and `POST /request-account`.
- [ ] Store account requests in PostgreSQL with `pending` status.
- [ ] Store successful login sessions in Redis.
- [ ] Redirect unauthenticated `/admin/*` requests to `/login`.
- [ ] Test account request submission and admin login.
- [ ] Commit: `Add login and account request routes`.

## Task 7: Admin Account Request Review

**Files:**

- Modify `src/adminRoutes.js`
- Modify `test/adminRoutes.test.js`

Steps:

- [ ] Add `GET /admin/account-requests`.
- [ ] Add approve, reject, and needs-info actions.
- [ ] Approval creates an active user assigned to an office.
- [ ] Reject and needs-info require admin notes.
- [ ] Test approval creates user and rejection without note returns 400.
- [ ] Commit: `Add account request review workflow`.

## Task 8: Office Content Submission

**Files:**

- Modify `src/adminRoutes.js`
- Modify `test/adminRoutes.test.js`

Steps:

- [ ] Add `GET /admin/content/new`.
- [ ] Add `POST /admin/content`.
- [ ] Allow office users to create content for their assigned office only.
- [ ] Store submissions in `content_items` and `content_versions` with `pending_review` status.
- [ ] Support content types: Citizen's Charter service, FAQ, event, project, program, activity.
- [ ] Test office user submission and cross-office protection.
- [ ] Commit: `Add office content submission`.

## Task 9: Admin Content Review And Cache Invalidation

**Files:**

- Modify `src/adminRoutes.js`
- Modify `src/publishedContentRepository.js`
- Modify `test/adminRoutes.test.js`

Steps:

- [ ] Add `GET /admin/reviews` and `GET /admin/reviews/:id`.
- [ ] Add approve, reject, and needs-revision actions.
- [ ] Approval sets `current_published_version_id`.
- [ ] Reject and needs-revision require review notes.
- [ ] Approval invalidates Redis keys `published:services` and `published:faqs`.
- [ ] Test approval publishes version and revision request stores note.
- [ ] Commit: `Add content review workflow`.

## Task 10: Published Chatbot Repository

**Files:**

- Create `src/publishedContentRepository.js`
- Modify `src/server.js`
- Create `test/publishedContentRepository.test.js`

Steps:

- [ ] Implement `loadPublishedServices({ pool, redis })`.
- [ ] Implement `loadPublishedFaqs({ pool, redis })`.
- [ ] Read from Redis first.
- [ ] On cache miss, read only published rows from PostgreSQL and repopulate Redis with 10-minute TTL.
- [ ] Update Messenger chatbot server path to use published services.
- [ ] Test pending content is excluded.
- [ ] Commit: `Connect chatbot to published content`.

## Task 11: Attachment Storage

**Files:**

- Create `src/uploads.js`
- Modify `src/adminRoutes.js`
- Create `test/uploads.test.js`

Steps:

- [ ] Validate allowed file types: PDF, PNG, JPEG, DOCX.
- [ ] Enforce a default 5 MB file limit.
- [ ] Save files under `UPLOAD_DIR` using generated filenames.
- [ ] Insert attachment metadata in PostgreSQL.
- [ ] Link attachments to account requests or content versions.
- [ ] Test safe filenames and size rejection.
- [ ] Commit: `Add attachment storage`.

## Task 12: Dashboards, Documentation, And Push

**Files:**

- Modify `src/adminRoutes.js`
- Modify `README.md`

Steps:

- [ ] Add admin dashboard counts for pending account requests, pending reviews, and published records.
- [ ] Add office dashboard showing submissions, status, and admin notes.
- [ ] Document PostgreSQL and Redis setup in `README.md`.
- [ ] Run `rtk npm test`.
- [ ] Run `rtk npm run migrate`.
- [ ] Run `rtk npm run seed`.
- [ ] Start server with `rtk npm start`.
- [ ] Commit: `Document PostgreSQL Redis admin app`.
- [ ] Push: `rtk git push origin main`.

## Self-Review

Spec coverage:

- Account request form: Tasks 6 and 7.
- Admin-created accounts: Task 7.
- Office-specific submission: Task 8.
- Admin review with notes: Tasks 7 and 9.
- Attachments: Task 11.
- Published chatbot read path: Task 10.
- Initial `data/services.json` import: Task 3.
- PostgreSQL and Redis requirement: Tasks 1 through 12.

PostgreSQL best-practice notes:

- Use explicit indexes for status queues and office/type filters.
- Keep pending and published versions separate.
- Use transactions for approval and publishing.
- Use partial index for active user lookup by email.
- Avoid reading pending records in chatbot queries.
