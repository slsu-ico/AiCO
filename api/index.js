const { getRuntimeConfig, validateConfig } = require('../src/config');
const { createPool } = require('../src/db/postgres');
const { createRedisClient } = require('../src/cache/redis');
const { createRequestHandler } = require('../src/server');

let handlerPromise;

function vercelOidcTokenFromRequest(request) {
  const value = request?.headers?.['x-vercel-oidc-token'];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

async function runtimeConfigForRequest(request, getRuntimeConfigImpl = getRuntimeConfig) {
  return getRuntimeConfigImpl(process.env, {
    vercelOidcToken: vercelOidcTokenFromRequest(request),
  });
}

async function createHandler(request) {
  const config = await runtimeConfigForRequest(request);
  validateConfig(config);
  const pool = createPool({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl });

  redis.connect().catch((error) => {
    console.error('Failed to connect to Redis:', error);
  });

  return createRequestHandler({
    verifyToken: config.verifyToken,
    verifyTokens: config.verifyTokens,
    messengerAppSecret: config.messengerAppSecret,
    pageAccessToken: config.pageAccessToken,
    pool,
    redis,
    sessionSecret: config.sessionSecret,
    sessionSecrets: config.sessionSecrets,
    runtimeConfigVersion: config.runtimeConfigVersion,
    webhookMaxBodyBytes: config.webhookMaxBodyBytes,
    messengerEventDedupTtlSeconds: config.messengerEventDedupTtlSeconds,
    secureCookies: process.env.NODE_ENV === 'production',
  });
}

module.exports = async function (request, response) {
  handlerPromise ||= createHandler(request).catch((error) => {
    handlerPromise = null;
    throw error;
  });
  const handler = await handlerPromise;
  await handler(request, response);
};

module.exports.runtimeConfigForRequest = runtimeConfigForRequest;
module.exports.vercelOidcTokenFromRequest = vercelOidcTokenFromRequest;
