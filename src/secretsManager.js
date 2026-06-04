const fs = require('node:fs/promises');

const DEFAULT_VAULT_SECRET_PATH = 'secret/data/aico/production';

function shouldUseManagedSecrets(env = process.env) {
  return env.SECRETS_MANAGER_PROVIDER === 'hashicorp-vault';
}

function normalizeVaultAddress(address) {
  if (!address) throw new Error('VAULT_ADDR is required when using HashiCorp Vault secrets.');
  return address.replace(/\/+$/, '');
}

async function readRequiredFile(filePath, label) {
  if (!filePath) return '';
  const value = (await fs.readFile(filePath, 'utf8')).trim();
  if (!value) throw new Error(`${label} file is empty.`);
  return value;
}

async function fetchVaultJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Vault request failed with ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}

async function getVaultToken({ env = process.env, fetchImpl = fetch }) {
  if (env.VAULT_JWT_AUTH_PATH && env.VAULT_JWT_ROLE) {
    const jwt =
      env.VAULT_JWT ||
      (await readRequiredFile(env.VAULT_JWT_FILE || env.VERCEL_OIDC_TOKEN_FILE, 'Vault JWT'));
    if (!jwt) throw new Error('VAULT_JWT_FILE or VERCEL_OIDC_TOKEN_FILE is required for Vault JWT auth.');

    const address = normalizeVaultAddress(env.VAULT_ADDR);
    const authPath = env.VAULT_JWT_AUTH_PATH.replace(/^\/+|\/+$/g, '');
    const result = await fetchVaultJson(
      `${address}/v1/auth/${authPath}/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: env.VAULT_JWT_ROLE, jwt }),
      },
      fetchImpl,
    );

    if (!result.auth?.client_token) throw new Error('Vault JWT auth response did not include a client token.');
    return result.auth.client_token;
  }

  const token = env.VAULT_TOKEN || (await readRequiredFile(env.VAULT_TOKEN_FILE, 'Vault token'));
  if (!token) throw new Error('VAULT_TOKEN_FILE is required when Vault JWT auth is not configured.');
  return token;
}

async function loadManagedSecrets({ env = process.env, fetchImpl = fetch } = {}) {
  if (!shouldUseManagedSecrets(env)) return {};

  const address = normalizeVaultAddress(env.VAULT_ADDR);
  const path = (env.VAULT_SECRET_PATH || DEFAULT_VAULT_SECRET_PATH).replace(/^\/+/, '');
  const token = await getVaultToken({ env, fetchImpl });
  const headers = { 'x-vault-token': token };
  if (env.VAULT_NAMESPACE) headers['x-vault-namespace'] = env.VAULT_NAMESPACE;

  const result = await fetchVaultJson(`${address}/v1/${path}`, { headers }, fetchImpl);
  const data = result.data?.data || result.data || {};

  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => typeof value === 'string' && value.length > 0),
  );
}

module.exports = {
  DEFAULT_VAULT_SECRET_PATH,
  getVaultToken,
  loadManagedSecrets,
  shouldUseManagedSecrets,
};
