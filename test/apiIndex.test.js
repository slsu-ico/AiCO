const assert = require('node:assert/strict');
const test = require('node:test');

const apiHandler = require('../api/index');

test('Vercel API entrypoint forwards the request OIDC header into runtime config', async () => {
  const calls = [];
  const expected = { loaded: true };
  const actual = await apiHandler.runtimeConfigForRequest(
    { headers: { 'x-vercel-oidc-token': 'request-scoped-jwt' } },
    async (env, options) => {
      calls.push({ env, options });
      return expected;
    },
  );

  assert.equal(actual, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env, process.env);
  assert.deepEqual(calls[0].options, { vercelOidcToken: 'request-scoped-jwt' });
});

test('Vercel API entrypoint accepts the first OIDC header value only', () => {
  assert.equal(
    apiHandler.vercelOidcTokenFromRequest({
      headers: { 'x-vercel-oidc-token': ['first-jwt', 'second-jwt'] },
    }),
    'first-jwt',
  );
});
