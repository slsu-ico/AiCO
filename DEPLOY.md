# Deployment Guide

This project is a Node.js app that requires PostgreSQL, Redis, and a configured Meta Messenger app.

## Prerequisites

- Node.js 24 or newer
- pnpm 11 through Corepack
- PostgreSQL 14 or newer
- Redis 7 or newer
- A Meta app with Messenger access enabled
- A valid Facebook Page Access Token
- A public HTTPS URL for webhook callbacks

## Environment configuration

For local development only, copy the example file and populate values in a local `.env` file, or set values directly in your shell.

```powershell
Copy-Item .env.example .env
```

### Required local values

- `PORT` - HTTP port for the app (default `3000`)
- `MESSENGER_VERIFY_TOKEN` - webhook verification token used by Messenger
- `MESSENGER_APP_SECRET` - Meta app secret for webhook signature verification (optional locally, required in production)
- `PAGE_ACCESS_TOKEN` - Facebook Page access token for sending messages
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `UPLOAD_DIR` - local upload directory path (default `uploads`)
- `SESSION_SECRET` - secure random secret for admin session cookies
- `WEBHOOK_MAX_BODY_BYTES` - maximum Messenger webhook body size (default `1048576`)
- `MESSENGER_EVENT_DEDUP_TTL_SECONDS` - Redis duplicate-event retention in seconds (default `86400`)
- `BOOTSTRAP_ADMIN_EMAIL` - initial admin email used by seed command
- `BOOTSTRAP_ADMIN_PASSWORD` - initial bootstrap admin password used only during seeding

### Optional fallback flag

- `AI_FALLBACK_ENABLED=false` - reserved flag; current chatbot path uses published content first.

## Production secrets manager

Production secrets must live in HashiCorp Vault KV v2, not in `.env` files and not in Vercel dashboard environment variables.

Set only non-secret bootstrap configuration in the production runtime:

- `SECRETS_MANAGER_PROVIDER=hashicorp-vault`
- `VAULT_ADDR`
- `VAULT_SECRET_PATH` such as `secret/data/aico/production`
- `VAULT_JWT_AUTH_PATH`
- `VAULT_JWT_ROLE`
- `VAULT_NAMESPACE` when needed
- `VAULT_JWT_FILE` for local or CI file-based workload identity. On Vercel, `api/index.js` forwards the platform-provided `x-vercel-oidc-token` request header to Vault authentication; do not copy that token into an environment variable.

The Vault secret should contain:

- `MESSENGER_VERIFY_TOKEN_CURRENT`
- `MESSENGER_VERIFY_TOKEN_PREVIOUS` during rotation only
- `MESSENGER_APP_SECRET`
- `PAGE_ACCESS_TOKEN`
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET_CURRENT`
- `SESSION_SECRET_PREVIOUS` during rotation only
- `RUNTIME_CONFIG_VERSION` generated automatically by the rotation command to verify that the new deployment is live
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD` only for initial seeding
- `VERCEL_DEPLOY_HOOK_URL`
- `ROTATION_HEALTH_URL`
- `ROTATION_WEBHOOK_VERIFY_URL`

Vault must have audit logging enabled and KV v2 versioning retained. The app role is read-only for the production secret path. The rotation role can read and update only that path.

## Database setup

Create or update the database schema and seed initial data.

```powershell
corepack enable
corepack pnpm install
corepack pnpm run migrate
corepack pnpm run seed
```

The migration deliberately stops before adding uniqueness constraints if the existing database contains case-insensitive duplicate active-user emails, duplicate published service IDs, or legacy published chatbot payloads that do not satisfy the canonical service/FAQ contract. Back up the database, resolve the rows identified by the migration error, and rerun it. It does not deactivate accounts or rewrite published content automatically.

Before migration, this query finds active email collisions:

```sql
SELECT lower(email) AS normalized_email, array_agg(id ORDER BY id) AS user_ids
FROM users
WHERE active = true
GROUP BY lower(email)
HAVING count(*) > 1;
```

This query finds duplicate IDs among currently published services:

```sql
SELECT lower(coalesce(cv.structured_payload->>'id', cv.structured_payload->>'service_id')) AS service_id,
       array_agg(ci.id ORDER BY ci.id) AS content_item_ids
FROM content_items ci
JOIN content_versions cv ON cv.id = ci.current_published_version_id
WHERE ci.active = true
  AND ci.content_type = 'citizens_charter_service'
GROUP BY lower(coalesce(cv.structured_payload->>'id', cv.structured_payload->>'service_id'))
HAVING count(*) > 1;
```

### Seed command note

`corepack pnpm run seed` requires `BOOTSTRAP_ADMIN_PASSWORD` to be set. Use a strong temporary password, then rotate or disable the bootstrap credential after initial setup.

## Running the app

Start the app locally with:

```powershell
corepack pnpm start
```

The admin portal is available at:

- `http://localhost:3000/login`

The Messenger webhook callback path is:

- `https://<your-domain>/webhook`

## Meta Messenger setup

1. Create or open a Meta app.
2. Add Messenger to the app.
3. Generate a Page Access Token for your Facebook Page.
4. Deploy the app to a public HTTPS host.
5. Configure the webhook callback URL to:

   `https://<your-domain>/webhook`

6. Set the webhook verify token to the same value as `MESSENGER_VERIFY_TOKEN`.
7. Store the app's Meta App Secret as `MESSENGER_APP_SECRET` in Vault.
8. Subscribe the Page to message events.
9. Send a test message to the Page.

## Production guidance

- Do not run production with the default `MESSENGER_VERIFY_TOKEN`.
- Do not run production without `MESSENGER_APP_SECRET`; unsigned or incorrectly signed webhook requests are rejected.
- Do not commit `.env` or any secrets to source control.
- Use a secure `SESSION_SECRET` and rotate it when needed.
- Ensure Redis is reachable from the deployment environment.
- Ensure `DATABASE_URL` points to the correct production database.

## Validation

After deployment, verify:

- `/login` loads the admin portal
- `/webhook` verifies successfully with the Messenger verify token
- the app can connect to PostgreSQL and Redis
- published content is served only from approved records

## Vercel + Supabase deployment

This repo can be deployed on Vercel as a single serverless function with Supabase providing the PostgreSQL database.

### What is required

- `DATABASE_URL` from Supabase Postgres
- `REDIS_URL` from a managed Redis provider such as Upstash, Redis Enterprise, or another external Redis instance
- `PAGE_ACCESS_TOKEN`
- `MESSENGER_VERIFY_TOKEN`
- `MESSENGER_APP_SECRET`
- `SESSION_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

### Important notes

- Vercel does not provide persistent local disk storage for uploaded files. The app currently uses local file metadata for attachments only, so persistent file uploads require an external storage provider or app changes.
- Messenger events are deduplicated in Redis and serialized per sender within one warm runtime, but replies are still processed synchronously. Durable ordering across multiple function instances requires a managed queue or transactional inbox/worker before high-volume scale-out.
- Chatbot sessions are persisted in Redis when `REDIS_URL` is configured, which is essential for correct behavior on serverless platforms.
- Supabase provides Postgres, but not Redis. A separate Redis service is required for cache and admin sessions.
- In production, `DATABASE_URL` and `REDIS_URL` must point to real cloud services. Local URLs such as `localhost` will cause the deployment to hang or timeout.
- The deployed app now validates required production environment variables and fails fast if any required cloud settings are missing.

### Vercel setup

1. Create a Vercel project and connect this repository.
2. Add only non-secret Vault bootstrap values outside the dashboard secret store.
3. Enable Vercel workload identity/OIDC and configure Vault to trust the Vercel token claims for this project.
4. Deploy the project.

The `vercel.json` file rewrites all requests to `api/index.js`, so the admin routes and `/webhook` endpoint work through Vercel serverless functions.

#### Vault bootstrap helper

The helper validates and uploads only non-secret Vault bootstrap configuration. It never copies application secrets such as database credentials or access tokens to Vercel.
It requires an existing `.vercel/project.json` link and updates existing production values idempotently.

```powershell
cd .\scripts
.\setup-vercel-env.ps1
```

Application secrets remain in Vault. On each cold start, the API entrypoint exchanges Vercel's request-scoped OIDC header for a short-lived Vault token.
Secret rotation polls `/health` until its generated runtime configuration marker is served; a deploy-hook acceptance or an old healthy deployment is not treated as completion.

### Provisioning Supabase + Upstash

The deployed app needs two managed services:

- `DATABASE_URL` from a hosted PostgreSQL provider such as Supabase
- `REDIS_URL` from a managed Redis provider such as Upstash

#### Supabase provisioning

1. Create a Supabase project at https://app.supabase.com.
2. Open the project and go to Settings > Database > Connection Pooling or Connection string.
3. Copy the `postgres://...` connection string.
4. In your local shell or deployment environment, set:

```powershell
$env:DATABASE_URL = 'postgres://...'
```

5. Run migrations and seed the database against Supabase:

```powershell
cd ..
corepack pnpm run migrate
corepack pnpm run seed
```

6. Confirm the required tables exist and the bootstrap admin was created.

#### Upstash Redis provisioning

1. Create an Upstash Redis database at https://console.upstash.com.
2. Choose the Kafka-free Redis plan or the free tier.
3. Copy the `REDIS_URL` value from the connection details.
4. In your local shell or deployment environment, set:

```powershell
$env:REDIS_URL = 'rediss://...'
```

5. Verify connectivity by running a quick Redis check if you want:

```powershell
node -e "const { createClient } = require('redis'); const r = createClient({ url: process.env.REDIS_URL }); r.connect().then(()=>console.log('ok')).catch(console.error).finally(()=>r.disconnect())"
```

#### Store cloud service credentials in Vault

Once you have the values:

```powershell
$env:MESSENGER_VERIFY_TOKEN = 'your-verify-token'
$env:MESSENGER_APP_SECRET = 'your-meta-app-secret'
$env:PAGE_ACCESS_TOKEN = 'your-page-access-token'
$env:DATABASE_URL = 'your-supabase-connection-string'
$env:REDIS_URL = 'your-upstash-connection-string'
$env:SESSION_SECRET = 'your-long-secret'
$env:BOOTSTRAP_ADMIN_EMAIL = 'admin@slsu.edu.ph'
$env:BOOTSTRAP_ADMIN_PASSWORD = 'your-temporary-password'
```

Write them to Vault KV v2 at `secret/data/aico/production`. Do not add these secret values to Vercel.

Then run deployment with the non-secret Vault bootstrap values available to the runtime.

```powershell
cd .\scripts
.\deploy-prod.ps1
```

Do not add production secret values in the Vercel dashboard under Project Settings > Environment Variables.

#### Notes

- Supabase provides Postgres but not Redis, so Upstash or another Redis provider is required.
- The app will fail fast in production if `DATABASE_URL`, `REDIS_URL`, `PAGE_ACCESS_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_APP_SECRET`, or `SESSION_SECRET` are missing. Localhost and loopback database or Redis URLs are also rejected.
- Use `BOOTSTRAP_ADMIN_PASSWORD` only for initial seeding. After you create a proper admin account, rotate or remove the bootstrap credentials.

The deployment helper adds only `SECRETS_MANAGER_PROVIDER`, `VAULT_ADDR`, `VAULT_SECRET_PATH`, `VAULT_JWT_AUTH_PATH`, `VAULT_JWT_ROLE`, and optional `VAULT_NAMESPACE`. Application secrets stay in Vault.

### Supabase setup

1. Create a Supabase project.
2. Copy the Supabase Postgres connection string into `DATABASE_URL`.
3. Ensure `BOOTSTRAP_ADMIN_PASSWORD` is set for seeding.
4. Run migrations and seed locally against Supabase.

#### Helper script for database initialization

If the required values are available in your shell, run:

```powershell
cd .\scripts
.\run-db-init.ps1
```

This script executes:

```powershell
corepack pnpm run migrate
corepack pnpm run seed
```

It uses the current shell environment variables, so make sure `DATABASE_URL` and `BOOTSTRAP_ADMIN_PASSWORD` are set before running.

## Troubleshooting

- If tests fail locally, use `corepack pnpm test`.
- If webhook verification fails, check `MESSENGER_VERIFY_TOKEN`.
- If webhook event delivery returns `401`, check `MESSENGER_APP_SECRET` and Meta's `X-Hub-Signature-256` header.
- If Redis cache is stale, admin publication and the dashboard refresh action invalidate and warm `published:services` and `published:faqs`.
- If rotation verification fails, restore the previous Vault KV version, redeploy, and do not run `corepack pnpm run secrets:finalize`.
