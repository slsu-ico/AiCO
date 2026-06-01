const { createClient } = require('redis');

function createRedisClient(config = {}) {
  const url = config.redisUrl ?? config.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  if (url.startsWith('memory://')) {
    const store = new Map();
    return {
      async connect() {},
      async disconnect() {},
      async set(key, value) {
        store.set(key, value);
        return 'OK';
      },
      async get(key) {
        return store.get(key) ?? null;
      },
      async del(key) {
        const existed = store.delete(key);
        return existed ? 1 : 0;
      },
    };
  }

  return createClient({
    url,
    socket: {
      connectTimeout: 5000,
    },
  });
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
