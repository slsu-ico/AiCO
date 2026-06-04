const { getRuntimeConfig, validateConfig } = require('../src/config');
const { createPool } = require('../src/db/postgres');
const { createRedisClient } = require('../src/cache/redis');
const { createRequestHandler } = require('../src/server');

let handlerPromise;

async function createHandler() {
  const config = await getRuntimeConfig();
  validateConfig(config);
  const pool = createPool({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl });

  redis.connect().catch((error) => {
    console.error('Failed to connect to Redis:', error);
  });

  return createRequestHandler({
    verifyToken: config.verifyToken,
    verifyTokens: config.verifyTokens,
    pageAccessToken: config.pageAccessToken,
    pool,
    redis,
    sessionSecret: config.sessionSecret,
    secureCookies: process.env.NODE_ENV === 'production',
  });
}

module.exports = async function (request, response) {
  handlerPromise ||= createHandler();
  const handler = await handlerPromise;
  await handler(request, response);
};
