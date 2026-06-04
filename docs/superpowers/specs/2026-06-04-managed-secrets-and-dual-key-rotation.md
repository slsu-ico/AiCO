# Managed Secrets And Dual-Key Rotation

## Decision

Production secrets live in HashiCorp Vault KV v2, not in `.env` files and not in the Vercel dashboard. Vault provides audit logging, access policy enforcement, version history, and API-based rotation.

The app may keep non-secret bootstrap configuration in the runtime environment:

- `SECRETS_MANAGER_PROVIDER=hashicorp-vault`
- `VAULT_ADDR`
- `VAULT_SECRET_PATH`
- `VAULT_JWT_AUTH_PATH`
- `VAULT_JWT_ROLE`
- `VAULT_NAMESPACE` when the Vault cluster uses namespaces
- `VAULT_JWT_FILE` or `VERCEL_OIDC_TOKEN_FILE` for workload identity

Secret values are fetched from Vault at runtime.

## Vault Secret Shape

Store the production secret at `secret/data/aico/production` unless `VAULT_SECRET_PATH` overrides it.

Required fields:

- `MESSENGER_VERIFY_TOKEN_CURRENT`
- `PAGE_ACCESS_TOKEN`
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET_CURRENT`

Rotation fields:

- `MESSENGER_VERIFY_TOKEN_PREVIOUS`
- `SESSION_SECRET_PREVIOUS`
- `SECRET_ROTATION_STARTED_AT`
- `SECRET_ROTATION_REVOKE_AFTER`
- `SECRET_ROTATION_FINALIZED_AT`

Automation fields:

- `VERCEL_DEPLOY_HOOK_URL`
- `ROTATION_HEALTH_URL`
- `ROTATION_WEBHOOK_VERIFY_URL`

## Runtime Behavior

1. Serverless and direct server entrypoints call `getRuntimeConfig()`.
2. When `SECRETS_MANAGER_PROVIDER=hashicorp-vault`, the app authenticates to Vault using JWT/OIDC auth or a token file.
3. Managed secrets override process environment values.
4. During a rotation window, `MESSENGER_VERIFY_TOKEN_CURRENT` and `MESSENGER_VERIFY_TOKEN_PREVIOUS` are both accepted.
5. After finalization, previous keys are blanked in Vault and disappear on redeploy.

## Rotation Algorithm

Run `corepack pnpm run secrets:rotate` every 30 days.

1. Read the current Vault KV v2 version.
2. Generate a new Messenger verify token and admin session secret.
3. Promote old current values into the previous slots.
4. Store the new current values in Vault, creating a new KV version.
5. Trigger redeployment via the deploy hook stored in Vault.
6. Poll `ROTATION_HEALTH_URL`.
7. Verify the deployed webhook accepts `MESSENGER_VERIFY_TOKEN_CURRENT`.
8. Leave current and previous keys active until `SECRET_ROTATION_REVOKE_AFTER`.

Run `corepack pnpm run secrets:finalize` hourly or daily.

1. Read the current Vault KV v2 version.
2. Refuse to proceed before `SECRET_ROTATION_REVOKE_AFTER`.
3. Blank previous key fields.
4. Store a new Vault KV version.
5. Trigger redeployment and poll health.

## Guardrails

- No production secret values in `.env`, `.env.local`, `.env.production.local`, Vercel env vars, source code, or GitHub secrets.
- Use Vault JWT/OIDC auth for workloads and automation. Avoid long-lived `VAULT_TOKEN`; it is accepted only as a break-glass/manual operator path.
- Vault policy for the app is read-only on `secret/data/aico/production`.
- Vault policy for the rotation workflow can read and update only the same path.
- Vault audit devices must be enabled before production cutover.
- KV v2 versioning must stay enabled; do not destroy historical versions during normal rotation.
- The finalization command refuses early revocation unless an operator passes `--force`.
- Keep the transition window long enough for all active deployments and cold starts to pick up the new Vault version.
- If health or webhook verification fails, do not finalize. Roll back by restoring the previous Vault KV version and redeploying.

## Out Of Scope

Meta `PAGE_ACCESS_TOKEN`, database credentials, and Redis credentials are provider-owned secrets. This implementation stores and deploys them through Vault, but generation/revocation must use the provider APIs for Meta, Postgres, and Redis.
