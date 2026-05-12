const { createClient } = require('redis');

function createRedisClient(config = {}) {
  const url = config.redisUrl ?? config.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  return createClient({ url });
}

async function setJson(redis, key, value, options = {}) {
  const payload = JSON.stringify(value);
  const ttlSeconds = options.ttlSeconds ?? options.EX ?? options.ex;

  if (ttlSeconds) {
    await redis.set(key, payload, { expiration: { type: 'EX', value: ttlSeconds } });
    return;
  }

  await redis.set(key, payload);
}

async function getJson(redis, key) {
  const payload = await redis.get(key);
  if (payload == null) return null;
  return JSON.parse(payload);
}

async function deleteKey(redis, key) {
  const deleted = await redis.del(key);
  return deleted > 0;
}

module.exports = {
  createRedisClient,
  setJson,
  getJson,
  deleteKey,
};
