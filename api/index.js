const { getConfig, validateConfig } = require('../src/config');
const { createPool } = require('../src/db/postgres');
const { createRedisClient } = require('../src/cache/redis');
const { createRequestHandler } = require('../src/server');

const config = getConfig();
validateConfig(config);
const pool = createPool({ databaseUrl: config.databaseUrl });
const redis = createRedisClient({ redisUrl: config.redisUrl });

redis.connect().catch((error) => {
  console.error('Failed to connect to Redis:', error);
});

const handler = createRequestHandler({
  verifyToken: config.verifyToken,
  pageAccessToken: config.pageAccessToken,
  pool,
  redis,
  sessionSecret: config.sessionSecret,
  secureCookies: process.env.NODE_ENV === 'production',
});

module.exports = async function (request, response) {
  await handler(request, response);
};
