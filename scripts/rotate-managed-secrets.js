#!/usr/bin/env node
const crypto = require('node:crypto');

const DEFAULT_SECRET_PATH = 'secret/data/aico/production';
const DEFAULT_TRANSITION_MINUTES = 60;
const DEFAULT_HEALTH_TIMEOUT_MS = 30000;

function generateManagedSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function iso(date) {
  return date.toISOString();
}

function buildRotationPayload(current, options = {}) {
  const now = options.now || new Date();
  const transitionMinutes = Number(options.transitionMinutes || DEFAULT_TRANSITION_MINUTES);
  const revokeAfter = new Date(now.getTime() + transitionMinutes * 60 * 1000);

  return {
    ...current,
    MESSENGER_VERIFY_TOKEN_CURRENT:
      options.nextMessengerVerifyToken || generateManagedSecret(),
    MESSENGER_VERIFY_TOKEN_PREVIOUS:
      current.MESSENGER_VERIFY_TOKEN_CURRENT || current.MESSENGER_VERIFY_TOKEN || '',
    SESSION_SECRET_CURRENT: options.nextSessionSecret || generateManagedSecret(48),
    SESSION_SECRET_PREVIOUS: current.SESSION_SECRET_CURRENT || current.SESSION_SECRET || '',
    SECRET_ROTATION_STARTED_AT: iso(now),
    SECRET_ROTATION_REVOKE_AFTER: iso(revokeAfter),
    SECRET_ROTATION_FINALIZED_AT: '',
  };
}

function buildFinalizePayload(current, options = {}) {
  const now = options.now || new Date();
  const revokeAfter = new Date(current.SECRET_ROTATION_REVOKE_AFTER || 0);

  if (!options.force && (!Number.isFinite(revokeAfter.getTime()) || now < revokeAfter)) {
    throw new Error('Secret transition window has not ended; refusing to revoke previous keys.');
  }

  return {
    ...current,
    MESSENGER_VERIFY_TOKEN_PREVIOUS: '',
    SESSION_SECRET_PREVIOUS: '',
    SECRET_ROTATION_FINALIZED_AT: iso(now),
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readFileIfPresent(filePath) {
  if (!filePath) return '';
  const fs = require('node:fs/promises');
  return (await fs.readFile(filePath, 'utf8')).trim();
}

async function getVaultToken() {
  if (process.env.VAULT_TOKEN) return process.env.VAULT_TOKEN;

  if (process.env.VAULT_JWT_AUTH_PATH && process.env.VAULT_JWT_ROLE) {
    const address = requiredEnv('VAULT_ADDR').replace(/\/+$/, '');
    const jwt = process.env.VAULT_JWT || (await readFileIfPresent(process.env.VAULT_JWT_FILE));
    if (!jwt) throw new Error('VAULT_JWT_FILE or VAULT_JWT is required for Vault JWT auth.');

    const authPath = process.env.VAULT_JWT_AUTH_PATH.replace(/^\/+|\/+$/g, '');
    const response = await fetch(`${address}/v1/auth/${authPath}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: process.env.VAULT_JWT_ROLE, jwt }),
    });

    if (!response.ok) {
      throw new Error(`Vault JWT login failed with ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    if (!result.auth?.client_token) throw new Error('Vault JWT login did not return a client token.');
    return result.auth.client_token;
  }

  throw new Error('VAULT_TOKEN or Vault JWT auth env vars are required.');
}

function vaultHeaders(token) {
  const headers = {
    'content-type': 'application/json',
    'x-vault-token': token,
  };
  if (process.env.VAULT_NAMESPACE) headers['x-vault-namespace'] = process.env.VAULT_NAMESPACE;
  return headers;
}

async function vaultRequest(path, options = {}) {
  const address = requiredEnv('VAULT_ADDR').replace(/\/+$/, '');
  const token = await getVaultToken();
  const response = await fetch(`${address}/v1/${path.replace(/^\/+/, '')}`, {
    ...options,
    headers: {
      ...vaultHeaders(token),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Vault request failed with ${response.status}: ${body || response.statusText}`);
  }

  return response.status === 204 ? {} : response.json();
}

async function readVaultSecret(secretPath) {
  const result = await vaultRequest(secretPath);
  return result.data?.data || result.data || {};
}

async function writeVaultSecret(secretPath, data) {
  await vaultRequest(secretPath, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}

async function triggerRedeploy(data) {
  const deployHookUrl = data.VERCEL_DEPLOY_HOOK_URL || process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!deployHookUrl) {
    console.log('No deploy hook configured; skipping redeploy trigger.');
    return;
  }

  const response = await fetch(deployHookUrl, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Redeploy hook failed with ${response.status}: ${await response.text()}`);
  }
  console.log('Redeploy hook accepted.');
}

async function verifyHealth(data) {
  const healthUrl = data.ROTATION_HEALTH_URL || process.env.ROTATION_HEALTH_URL;
  if (!healthUrl) {
    console.log('No ROTATION_HEALTH_URL configured; skipping health check.');
    return;
  }

  const deadline = Date.now() + Number(process.env.ROTATION_HEALTH_TIMEOUT_MS || DEFAULT_HEALTH_TIMEOUT_MS);
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { cache: 'no-store' });
      if (response.ok) {
        console.log(`Health check passed: ${healthUrl}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Health check did not pass before timeout: ${lastError}`);
}

async function verifyWebhookToken(data) {
  const webhookUrl = data.ROTATION_WEBHOOK_VERIFY_URL || process.env.ROTATION_WEBHOOK_VERIFY_URL;
  if (!webhookUrl) {
    console.log('No ROTATION_WEBHOOK_VERIFY_URL configured; skipping webhook token verification.');
    return;
  }

  const url = new URL(webhookUrl);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', data.MESSENGER_VERIFY_TOKEN_CURRENT);
  url.searchParams.set('hub.challenge', 'rotation-ok');

  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok || body !== 'rotation-ok') {
    throw new Error(`Webhook verification failed with ${response.status}: ${body}`);
  }
  console.log('Webhook verification passed with the current token.');
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'rotate';
  const secretPath = process.env.VAULT_SECRET_PATH || DEFAULT_SECRET_PATH;
  const current = await readVaultSecret(secretPath);

  if (command === 'rotate') {
    const next = buildRotationPayload(current, {
      transitionMinutes: process.env.SECRET_ROTATION_TRANSITION_MINUTES,
    });
    await writeVaultSecret(secretPath, next);
    await triggerRedeploy(next);
    await verifyHealth(next);
    await verifyWebhookToken(next);
    console.log(`Rotation promoted new keys. Revoke old keys after ${next.SECRET_ROTATION_REVOKE_AFTER}.`);
    return;
  }

  if (command === 'finalize') {
    const next = buildFinalizePayload(current, { force: argv.includes('--force') });
    await writeVaultSecret(secretPath, next);
    await triggerRedeploy(next);
    await verifyHealth(next);
    console.log('Rotation finalized and previous keys revoked.');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildFinalizePayload,
  buildRotationPayload,
  generateManagedSecret,
  main,
};
