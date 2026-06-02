const { getJson, setJson } = require('./cache/redis');

const PUBLISHED_SERVICES_KEY = 'published:services';
const PUBLISHED_FAQS_KEY = 'published:faqs';

function parseStructuredPayload(value) {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  return value;
}

async function loadPublishedPayloads({ pool, redis, cacheKey, contentType, forceRefresh = false }) {
  if (!forceRefresh) {
    const cached = await getJson(redis, cacheKey);
    if (cached) return cached;
  }

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
  await setJson(redis, cacheKey, payloads);
  return payloads;
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
