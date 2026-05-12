const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadPublishedFaqs,
  loadPublishedServices,
} = require('../src/publishedContentRepository');

class FakeRedis {
  constructor(entries = []) {
    this.store = new Map(entries);
    this.setCalls = [];
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async set(key, value, options) {
    this.setCalls.push({ key, value, options });
    this.store.set(key, value);
    return 'OK';
  }
}

function sqlIncludes(text, expected) {
  return text.replace(/\s+/g, ' ').includes(expected);
}

function createFakePool(rows) {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

test('loadPublishedServices returns Redis JSON cache without querying PostgreSQL', async () => {
  const cached = [{ id: 'student-exchange', service_name: 'Student Exchange' }];
  const redis = new FakeRedis([['published:services', JSON.stringify(cached)]]);
  const pool = createFakePool([]);

  const services = await loadPublishedServices({ pool, redis });

  assert.deepEqual(services, cached);
  assert.equal(pool.calls.length, 0);
});

test('loadPublishedServices queries published active service payloads and caches them', async () => {
  const redis = new FakeRedis();
  const servicePayload = {
    id: 'visa-assistance',
    service_name: 'Visa Assistance',
    audience: 'external',
  };
  const pool = createFakePool([{ structured_payload: servicePayload }]);

  const services = await loadPublishedServices({ pool, redis });

  assert.deepEqual(services, [servicePayload]);
  assert.equal(pool.calls.length, 1);
  assert.ok(sqlIncludes(pool.calls[0].text, 'FROM content_items ci'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'JOIN content_versions cv ON cv.id = ci.current_published_version_id'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.active = true'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.content_type = $1'));
  assert.ok(sqlIncludes(pool.calls[0].text, "cv.status = 'published'"));
  assert.deepEqual(pool.calls[0].params, ['citizens_charter_service']);
  assert.deepEqual(redis.setCalls, [{
    key: 'published:services',
    value: JSON.stringify([servicePayload]),
    options: { expiration: { type: 'EX', value: 600 } },
  }]);
});

test('loadPublishedFaqs queries only published active FAQ payloads and caches them', async () => {
  const redis = new FakeRedis();
  const faqPayload = {
    question: 'How do I request documents?',
    answer: 'Submit the form to ICO.',
  };
  const pool = createFakePool([{ structured_payload: faqPayload }]);

  const faqs = await loadPublishedFaqs({ pool, redis });

  assert.deepEqual(faqs, [faqPayload]);
  assert.equal(pool.calls.length, 1);
  assert.ok(sqlIncludes(pool.calls[0].text, 'FROM content_items ci'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'JOIN content_versions cv ON cv.id = ci.current_published_version_id'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.active = true'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.content_type = $1'));
  assert.ok(sqlIncludes(pool.calls[0].text, "cv.status = 'published'"));
  assert.deepEqual(pool.calls[0].params, ['faq']);
  assert.deepEqual(redis.setCalls, [{
    key: 'published:faqs',
    value: JSON.stringify([faqPayload]),
    options: { expiration: { type: 'EX', value: 600 } },
  }]);
});
