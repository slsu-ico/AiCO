const assert = require('node:assert/strict');
const test = require('node:test');

const { getVaultToken } = require('../src/secretsManager');

test('getVaultToken exchanges a request-scoped Vercel OIDC token with Vault', async () => {
  const calls = [];
  const token = await getVaultToken({
    env: {
      VAULT_ADDR: 'https://vault.example.test/',
      VAULT_JWT_AUTH_PATH: 'jwt-vercel',
      VAULT_JWT_ROLE: 'aico-production',
    },
    oidcToken: 'vercel-runtime-jwt',
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { auth: { client_token: 'vault-client-token' } };
        },
      };
    },
  });

  assert.equal(token, 'vault-client-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://vault.example.test/v1/auth/jwt-vercel/login');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    role: 'aico-production',
    jwt: 'vercel-runtime-jwt',
  });
});
