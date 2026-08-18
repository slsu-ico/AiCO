const { createClient } = require('redis');

const fallbackStores = new WeakMap();

function fallbackStore(redis) {
  if (!redis || (typeof redis !== 'object' && typeof redis !== 'function')) return null;
  let store = fallbackStores.get(redis);
  if (!store) {
    store = new Map();
    fallbackStores.set(redis, store);
  }
  return store;
}

function setFallback(redis, key, payload, ttlSeconds) {
  const store = fallbackStore(redis);
  if (!store) return;

  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  store.set(key, { payload, expiresAt });
}

function getFallback(redis, key) {
  const store = fallbackStore(redis);
  if (!store) return null;

  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.payload;
}

function deleteFallback(redis, key) {
  const store = fallbackStore(redis);
  return store ? store.delete(key) : false;
}

function createRedisClient(config = {}) {
  const url = config.redisUrl ?? config.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  if (url.startsWith('memory://')) {
    const store = new Map();
    return {
      async connect() {},
      async disconnect() {},
      async set(key, value, options = {}) {
        const existing = store.get(key);
        if (existing?.expiresAt !== null && existing?.expiresAt <= Date.now()) {
          store.delete(key);
        }

        const condition = options.condition ?? (options.NX ? 'NX' : options.XX ? 'XX' : null);
        if (condition === 'NX' && store.has(key)) return null;
        if (condition === 'XX' && !store.has(key)) return null;

        const expiration =
          options.expiration ??
          (options.EX !== undefined
            ? { type: 'EX', value: options.EX }
            : options.PX !== undefined
              ? { type: 'PX', value: options.PX }
              : null);
        let expiresAt = null;
        if (expiration?.type === 'EX') {
          expiresAt = Date.now() + Number(expiration.value) * 1000;
        } else if (expiration?.type === 'PX') {
          expiresAt = Date.now() + Number(expiration.value);
        }

        store.set(key, { value, expiresAt });
        return 'OK';
      },
      async get(key) {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      async del(key) {
        const entry = store.get(key);
        if (entry?.expiresAt !== null && entry?.expiresAt <= Date.now()) {
          store.delete(key);
          return 0;
        }

        const existed = store.delete(key);
        return existed ? 1 : 0;
      },
    };
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: 5000,
    },
  });
  client.on('error', () => {
    // Operations use the process-local fallback where possible; avoid unhandled Redis error events.
  });
  return client;
}

async function setJson(redis, key, value, options = {}) {
  const payload = JSON.stringify(value);
  const ttlSeconds = options.ttlSeconds ?? options.EX ?? options.ex;

  if (ttlSeconds) {
    setFallback(redis, key, payload, ttlSeconds);
    try {
      await redis.set(key, payload, { expiration: { type: 'EX', value: ttlSeconds } });
      return true;
    } catch {
      return false;
    }
  }

  setFallback(redis, key, payload, ttlSeconds);
  try {
    await redis.set(key, payload);
    return true;
  } catch {
    // The process-local fallback keeps admin sessions usable during short Redis outages.
    return false;
  }
}

async function getJson(redis, key) {
  let payload;
  try {
    payload = await redis.get(key);
  } catch {
    payload = getFallback(redis, key);
  }
  if (payload === null || payload === undefined) return null;
  return JSON.parse(payload);
}

async function deleteKey(redis, key) {
  const fallbackDeleted = deleteFallback(redis, key);
  try {
    const deleted = await redis.del(key);
    return deleted > 0 || fallbackDeleted;
  } catch {
    return fallbackDeleted;
  }
}

module.exports = {
  createRedisClient,
  setJson,
  getJson,
  deleteKey,
};
