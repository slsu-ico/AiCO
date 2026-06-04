# ICO Services Messenger Chatbot

Facebook Messenger chatbot and AiCO admin portal for Southern Luzon State University ICO services listed in the ICO Citizen's Charter 2026.

## What It Does

- Answers Messenger questions from approved ICO service records.
- Guides internal offices and external partners to the right Citizen's Charter service.
- Provides an admin portal for account requests, office content submissions, admin review, and publication.
- Keeps pending edits out of live chatbot answers until an administrator publishes them.

## Requirements

- Node.js 24 or newer
- pnpm 11 through Corepack
- Docker Desktop or Docker Engine with Compose for local PostgreSQL and Redis
- PostgreSQL 14 or newer if you are not using Docker
- Redis 7 or newer if you are not using Docker
- A Meta app with Messenger configured
- A Facebook Page access token
- A public HTTPS deployment URL for live Messenger testing

## PostgreSQL And Redis With Docker

Start local PostgreSQL and Redis services:

```powershell
corepack pnpm run docker:up
```

The Compose stack exposes the same defaults used by the app:

```text
postgres://postgres:postgres@localhost:5432/aico
redis://localhost:6379
```

Stop the local services:

```powershell
corepack pnpm run docker:down
```

Follow container logs when needed:

```powershell
corepack pnpm run docker:logs
```

You can also run the app container with its dependencies:

```powershell
docker compose up app
```

## PostgreSQL And Redis Without Docker

Create a PostgreSQL database and make sure Redis is running locally or remotely. The default local URLs are:

```text
postgres://postgres:postgres@localhost:5432/aico
redis://localhost:6379
```

For cloud hosting, use a managed Postgres provider such as Supabase, Neon, or AWS RDS, and a managed Redis provider such as Upstash, Redis Enterprise, or Amazon MemoryDB.

Copy the example environment file as a local reference:

```powershell
Copy-Item .env.example .env
```

Set these values in your shell, process manager, or deployment environment before running commands:

- `PORT`: HTTP port, default `3000`.
- `MESSENGER_VERIFY_TOKEN`: webhook verify token configured in Meta.
- `PAGE_ACCESS_TOKEN`: Facebook Page access token for replies.
- `DATABASE_URL`: PostgreSQL connection string. In production, this must point to a cloud database such as Supabase, Neon, RDS, or another hosted Postgres instance.
- `REDIS_URL`: Redis connection string. In production, use a managed Redis provider such as Upstash, Redis Enterprise, Amazon MemoryDB, or another external Redis service.
- `UPLOAD_DIR`: local upload storage path, default `uploads`.
- `SESSION_SECRET`: long random secret for admin sessions.
- `BOOTSTRAP_ADMIN_EMAIL`: email for the initial admin user.
- `BOOTSTRAP_ADMIN_PASSWORD`: temporary initial admin password used only by the seed command.
- `AI_FALLBACK_ENABLED`: reserved flag in `.env.example`; the current chatbot path is published-content first.

Production secrets must be stored in HashiCorp Vault, not `.env` files and not Vercel dashboard environment variables. Set only non-secret Vault bootstrap values in the runtime environment:

- `SECRETS_MANAGER_PROVIDER=hashicorp-vault`
- `VAULT_ADDR`
- `VAULT_SECRET_PATH`
- `VAULT_JWT_AUTH_PATH`
- `VAULT_JWT_ROLE`
- `VAULT_JWT_FILE` or `VERCEL_OIDC_TOKEN_FILE`

The app fetches Vault values at startup. During rotation it accepts both `MESSENGER_VERIFY_TOKEN_CURRENT` and `MESSENGER_VERIFY_TOKEN_PREVIOUS`.

## Setup

Install dependencies:

```powershell
corepack enable
corepack pnpm install
```

Start local Postgres and Redis if you are using Docker:

```powershell
corepack pnpm run docker:up
```

Create or update the database schema:

```powershell
corepack pnpm run migrate
```

Or run the migration inside the Compose app container:

```powershell
corepack pnpm run docker:migrate
```

Seed the ICO office, bootstrap admin, and initial published Citizen's Charter services:

```powershell
corepack pnpm run seed
```

Or seed from the Compose app container:

```powershell
corepack pnpm run docker:seed
```

Start the webhook and admin server:

```powershell
corepack pnpm start
```

The Messenger webhook callback path is:

```text
/webhook
```

The admin portal starts at:

```text
/login
```

## Bootstrap Admin Warning

Set `BOOTSTRAP_ADMIN_PASSWORD` to a strong temporary value before running `corepack pnpm run seed`. Sign in with `BOOTSTRAP_ADMIN_EMAIL`, create/approve proper admin accounts as needed, then rotate or disable the bootstrap credential according to your deployment process.

## Chatbot Published Content

The chatbot reads only active, published records from PostgreSQL through `src/publishedContentRepository.js`. Published services and FAQs are cached in Redis under `published:services` and `published:faqs`. Admin approval and the dashboard refresh action invalidate and immediately warm those Redis keys so the next chatbot request can use the refreshed cache. Pending review, rejected, and needs revision records never affect live chatbot answers.

### Live cloud updates

To update live chatbot content in the cloud, publish content through the admin portal on the deployed app or edit the production Postgres tables directly. After publication, the admin flow reloads fresh content into Redis. If production data is edited directly, use the admin dashboard refresh action to warm the published cache.

## Important Paths

- `src/server.js`: HTTP server, Messenger webhook, and route wiring.
- `src/adminRoutes.js`: admin portal routes, dashboards, account request review, content submission, review, and publication.
- `src/db/schema.sql`: PostgreSQL schema.
- `src/db/migrate.js`: schema migration runner.
- `src/db/seed.js`: bootstrap admin and initial service content seeding.
- `src/publishedContentRepository.js`: database and Redis read path for chatbot content.
- `src/layout.js`: SLSU branded admin layout.
- `test/adminRoutes.test.js`: admin portal route tests with fake PostgreSQL and Redis services.
- `data/services.json`: source service data imported by the seed command.
- `uploads/`: default local attachment storage directory.

## Meta Messenger Setup

1. Create or open a Meta app.
2. Add Messenger to the app.
3. Generate a Page Access Token for the Facebook Page.
4. Deploy this app to a public HTTPS host.
5. Set the webhook callback URL to `https://your-domain.example/webhook`.
6. Use the same verify token as `MESSENGER_VERIFY_TOKEN`.
7. Subscribe the Page to message events.
8. Send a test message to the Page.

## Development

Run the same checks used by CI:

```powershell
corepack pnpm run ci
```

Run all tests:

```powershell
corepack pnpm test
```

Run only the admin route tests:

```powershell
corepack pnpm test -- test/adminRoutes.test.js
```

GitHub Actions runs lint and tests on pushes to `main` and on pull requests.

## Secret Rotation

Managed app-owned keys rotate with:

```powershell
corepack pnpm run secrets:rotate
```

That command writes a new Vault KV version, triggers redeploy when `VERCEL_DEPLOY_HOOK_URL` is stored in Vault, polls health, and verifies the webhook with the new key. It keeps old and new keys active during the transition window.

After `SECRET_ROTATION_REVOKE_AFTER`, revoke the previous keys with:

```powershell
corepack pnpm run secrets:finalize
```

The scheduled workflow in `.github/workflows/secret-rotation.yml` runs rotation every 30 days and finalization hourly. See `docs/superpowers/specs/2026-06-04-managed-secrets-and-dual-key-rotation.md` for the production spec and guardrails.

## Notes

The chatbot does not replace official ICO Job Order forms. It guides users to the correct service information and official request links.
