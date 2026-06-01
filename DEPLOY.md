# Deployment Guide

This project is a Node.js app that requires PostgreSQL, Redis, and a configured Meta Messenger app.

## Prerequisites

- Node.js 24 or newer
- PostgreSQL 14 or newer
- Redis 7 or newer
- A Meta app with Messenger access enabled
- A valid Facebook Page Access Token
- A public HTTPS URL for webhook callbacks

## Environment configuration

Copy the example file and populate secrets in a local `.env` file, or set the values directly in your deployment environment.

```powershell
Copy-Item .env.example .env
```

### Required environment variables

- `PORT` - HTTP port for the app (default `3000`)
- `MESSENGER_VERIFY_TOKEN` - webhook verification token used by Messenger
- `PAGE_ACCESS_TOKEN` - Facebook Page access token for sending messages
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `UPLOAD_DIR` - local upload directory path (default `uploads`)
- `SESSION_SECRET` - secure random secret for admin session cookies
- `BOOTSTRAP_ADMIN_EMAIL` - initial admin email used by seed command
- `BOOTSTRAP_ADMIN_PASSWORD` - initial bootstrap admin password used only during seeding

### Optional fallback flag

- `AI_FALLBACK_ENABLED=false` - reserved flag; current chatbot path uses published content first.

## Database setup

Create or update the database schema and seed initial data.

```powershell
npm install
npm run migrate
npm run seed
```

### Seed command note

`npm run seed` requires `BOOTSTRAP_ADMIN_PASSWORD` to be set. Use a strong temporary password, then rotate or disable the bootstrap credential after initial setup.

## Running the app

Start the app locally with:

```powershell
npm start
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
7. Subscribe the Page to message events.
8. Send a test message to the Page.

## Production guidance

- Do not run production with the default `MESSENGER_VERIFY_TOKEN`.
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
- `SESSION_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

### Important notes

- Vercel does not provide persistent local disk storage for uploaded files. The app currently uses local file metadata for attachments only, so persistent file uploads require an external storage provider or app changes.
- Chatbot sessions are persisted in Redis when `REDIS_URL` is configured, which is essential for correct behavior on serverless platforms.
- Supabase provides Postgres, but not Redis. A separate Redis service is required for cache and admin sessions.
- In production, `DATABASE_URL` and `REDIS_URL` must point to real cloud services. Local URLs such as `localhost` will cause the deployment to hang or timeout.
- The deployed app now validates required production environment variables and fails fast if any required cloud settings are missing.

### Vercel setup

1. Create a Vercel project and connect this repository.
2. Add the required environment variables in the Vercel dashboard or use the helper script below.
3. Deploy the project.

The `vercel.json` file rewrites all requests to `api/index.js`, so the admin routes and `/webhook` endpoint work through Vercel serverless functions.

#### Helper script for Vercel env vars

If you have the production environment values available in your shell, run:

```powershell
cd .\scripts
.\setup-vercel-env.ps1
```

If you want to set the environment variables and deploy in one step, use the helper script created in `scripts/deploy-prod.ps1` after you have the required environment values set in your shell.

This script adds the following production variables to the linked Vercel project under `slsu-icos-projects`:

- `MESSENGER_VERIFY_TOKEN`
- `PAGE_ACCESS_TOKEN`
- `DATABASE_URL`
- `REDIS_URL`
- `UPLOAD_DIR`
- `SESSION_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `AI_FALLBACK_ENABLED`

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
npm run migrate
npm run seed
```

It uses the current shell environment variables, so make sure `DATABASE_URL` and `BOOTSTRAP_ADMIN_PASSWORD` are set before running.

## Troubleshooting

- If tests fail locally, use `npm test`.
- If webhook verification fails, check `MESSENGER_VERIFY_TOKEN`.
- If Redis cache is stale, admin publication invalidates `published:services` and `published:faqs`.
