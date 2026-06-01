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

## Troubleshooting

- If tests fail locally, use `npm test`.
- If webhook verification fails, check `MESSENGER_VERIFY_TOKEN`.
- If Redis cache is stale, admin publication invalidates `published:services` and `published:faqs`.
