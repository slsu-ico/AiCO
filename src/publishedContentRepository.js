const { getJson, setJson } = require('./cache/redis');

const PUBLISHED_SERVICES_KEY = 'published:services';
const PUBLISHED_FAQS_KEY = 'published:faqs';
const PUBLISHED_CACHE_TTL_SECONDS = 10 * 60;
const PUBLISHED_CACHE_TTL_JITTER_RATIO = 0.1;
const PUBLISHED_STALE_RETRY_SECONDS = 15;
const cacheStatesByPool = new WeakMap();

function parseStructuredPayload(value) {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  return value;
}

function publishedCacheTtlSeconds() {
  const jitterSeconds = PUBLISHED_CACHE_TTL_SECONDS * PUBLISHED_CACHE_TTL_JITTER_RATIO;
  const offset = (Math.random() * 2 - 1) * jitterSeconds;
  return Math.max(1, Math.round(PUBLISHED_CACHE_TTL_SECONDS + offset));
}

function cacheStateFor({ pool, redis, cacheKey }) {
  let statesByRedis = cacheStatesByPool.get(pool);
  if (!statesByRedis) {
    statesByRedis = new WeakMap();
    cacheStatesByPool.set(pool, statesByRedis);
  }

  let statesByKey = statesByRedis.get(redis);
  if (!statesByKey) {
    statesByKey = new Map();
    statesByRedis.set(redis, statesByKey);
  }

  let state = statesByKey.get(cacheKey);
  if (!state) {
    state = {
      generation: 0,
      hasLastKnown: false,
      inFlight: null,
      lastKnown: undefined,
      pendingCacheWrite: Promise.resolve(),
      staleRetryAfter: 0,
    };
    statesByKey.set(cacheKey, state);
  }

  return state;
}

async function commitPublishedPayloads({
  redis,
  cacheKey,
  payloads,
  state,
  generation,
  requireSharedCache,
}) {
  const write = state.pendingCacheWrite
    .catch(() => {})
    .then(async () => {
      if (generation !== state.generation) return false;

      const sharedCacheWritten = await setJson(redis, cacheKey, payloads, {
        ttlSeconds: publishedCacheTtlSeconds(),
      });
      if (generation !== state.generation) return false;

      state.lastKnown = payloads;
      state.hasLastKnown = true;
      state.staleRetryAfter = 0;

      if (requireSharedCache && !sharedCacheWritten) {
        const error = new Error(`Unable to warm shared published-content cache: ${cacheKey}`);
        error.code = 'PUBLISHED_CACHE_WRITE_FAILED';
        throw error;
      }

      return true;
    });

  state.pendingCacheWrite = write;
  return write;
}

async function refreshPublishedPayloads({
  pool,
  redis,
  cacheKey,
  contentType,
  state,
  generation,
  allowStaleOnError,
  requireSharedCache,
}) {
  try {
    const result = await pool.query(
      `
      SELECT cv.structured_payload
      FROM content_items ci
      JOIN content_versions cv ON cv.id = ci.current_published_version_id
      WHERE ci.active = true
        AND ci.content_type = $1
        AND cv.status = 'published'
      ORDER BY cv.published_at DESC NULLS LAST, cv.id DESC
    `,
      [contentType],
    );

    const payloads = result.rows.map((row) => parseStructuredPayload(row.structured_payload));
    const committed = await commitPublishedPayloads({
      redis,
      cacheKey,
      payloads,
      state,
      generation,
      requireSharedCache,
    });
    if (requireSharedCache && !committed) {
      const error = new Error(`Published-content cache refresh was superseded: ${cacheKey}`);
      error.code = 'PUBLISHED_CACHE_REFRESH_SUPERSEDED';
      throw error;
    }
    return payloads;
  } catch (error) {
    if (allowStaleOnError && state.hasLastKnown) {
      state.staleRetryAfter = Date.now() + PUBLISHED_STALE_RETRY_SECONDS * 1000;
      return state.lastKnown;
    }
    throw error;
  }
}

function beginCacheFill({
  pool,
  redis,
  cacheKey,
  contentType,
  state,
  generation,
  allowStaleOnError = true,
  requireSharedCache = false,
}) {
  const trackedFill = refreshPublishedPayloads({
    pool,
    redis,
    cacheKey,
    contentType,
    state,
    generation,
    allowStaleOnError,
    requireSharedCache,
  }).finally(() => {
    if (state.inFlight?.promise === trackedFill) state.inFlight = null;
  });

  state.inFlight = { generation, promise: trackedFill };
  return trackedFill;
}

async function loadPublishedPayloads({ pool, redis, cacheKey, contentType, forceRefresh = false }) {
  const state = cacheStateFor({ pool, redis, cacheKey });

  if (forceRefresh) {
    const generation = state.generation + 1;
    state.generation = generation;
    return beginCacheFill({
      pool,
      redis,
      cacheKey,
      contentType,
      state,
      generation,
      allowStaleOnError: false,
      requireSharedCache: true,
    });
  }

  const cacheReadGeneration = state.generation;
  let cached = null;
  try {
    cached = await getJson(redis, cacheKey);
  } catch {
    // Treat an unreadable cache entry as a miss and rebuild it from PostgreSQL.
  }

  if (cached !== null && cached !== undefined && cacheReadGeneration === state.generation) {
    state.lastKnown = cached;
    state.hasLastKnown = true;
    return cached;
  }

  if (state.hasLastKnown && Date.now() < state.staleRetryAfter) return state.lastKnown;

  if (state.inFlight?.generation === state.generation) {
    try {
      return await state.inFlight.promise;
    } catch (error) {
      if (state.hasLastKnown) return state.lastKnown;
      throw error;
    }
  }

  const generation = state.generation;
  return beginCacheFill({
    pool,
    redis,
    cacheKey,
    contentType,
    state,
    generation,
  });
}

async function loadPublishedServices({ pool, redis }) {
  return loadPublishedPayloads({
    pool,
    redis,
    cacheKey: PUBLISHED_SERVICES_KEY,
    contentType: 'citizens_charter_service',
  });
}

async function loadPublishedFaqs({ pool, redis }) {
  return loadPublishedPayloads({
    pool,
    redis,
    cacheKey: PUBLISHED_FAQS_KEY,
    contentType: 'faq',
  });
}

async function warmPublishedContentCache({ pool, redis }) {
  const [services, faqs] = await Promise.all([
    loadPublishedPayloads({
      pool,
      redis,
      cacheKey: PUBLISHED_SERVICES_KEY,
      contentType: 'citizens_charter_service',
      forceRefresh: true,
    }),
    loadPublishedPayloads({
      pool,
      redis,
      cacheKey: PUBLISHED_FAQS_KEY,
      contentType: 'faq',
      forceRefresh: true,
    }),
  ]);

  return { services, faqs };
}

module.exports = {
  loadPublishedFaqs,
  loadPublishedServices,
  warmPublishedContentCache,
};
