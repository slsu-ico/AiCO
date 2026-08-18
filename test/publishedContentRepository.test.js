const assert = require('node:assert/strict');
const test = require('node:test');
const { setImmediate: waitImmediate } = require('node:timers/promises');

const {
  loadPublishedFaqs,
  loadPublishedServices,
  warmPublishedContentCache,
} = require('../src/publishedContentRepository');
const { createRedisClient } = require('../src/cache/redis');

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

function assertCacheTtl(options) {
  assert.equal(options?.expiration?.type, 'EX');
  assert.ok(options.expiration.value >= 540);
  assert.ok(options.expiration.value <= 660);
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
  assert.ok(
    sqlIncludes(
      pool.calls[0].text,
      'JOIN content_versions cv ON cv.id = ci.current_published_version_id',
    ),
  );
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.active = true'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.content_type = $1'));
  assert.ok(sqlIncludes(pool.calls[0].text, "cv.status = 'published'"));
  assert.deepEqual(pool.calls[0].params, ['citizens_charter_service']);
  assert.deepEqual(redis.setCalls, [
    {
      key: 'published:services',
      value: JSON.stringify([servicePayload]),
      options: redis.setCalls[0].options,
    },
  ]);
  assertCacheTtl(redis.setCalls[0].options);
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
  assert.ok(
    sqlIncludes(
      pool.calls[0].text,
      'JOIN content_versions cv ON cv.id = ci.current_published_version_id',
    ),
  );
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.active = true'));
  assert.ok(sqlIncludes(pool.calls[0].text, 'ci.content_type = $1'));
  assert.ok(sqlIncludes(pool.calls[0].text, "cv.status = 'published'"));
  assert.deepEqual(pool.calls[0].params, ['faq']);
  assert.deepEqual(redis.setCalls, [
    {
      key: 'published:faqs',
      value: JSON.stringify([faqPayload]),
      options: redis.setCalls[0].options,
    },
  ]);
  assertCacheTtl(redis.setCalls[0].options);
});

test('loadPublishedServices shares one PostgreSQL cache fill across concurrent misses', async () => {
  const redis = new FakeRedis();
  const servicePayload = { id: 'shared-service', service_name: 'Shared Service' };
  let releaseQuery;
  const queryStarted = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  const pool = {
    calls: [],
    async query(text, params = []) {
      this.calls.push({ text, params });
      await queryStarted;
      return { rows: [{ structured_payload: servicePayload }] };
    },
  };

  const firstLoad = loadPublishedServices({ pool, redis });
  const secondLoad = loadPublishedServices({ pool, redis });

  await waitImmediate();
  assert.equal(pool.calls.length, 1);
  releaseQuery();

  const [first, second] = await Promise.all([firstLoad, secondLoad]);

  assert.deepEqual(first, [servicePayload]);
  assert.deepEqual(second, [servicePayload]);
  assert.equal(pool.calls.length, 1);
  assert.equal(redis.setCalls.length, 1);
});

test('concurrent cache fills are isolated by their pool and Redis context', async () => {
  const firstPayload = { id: 'first-context', service_name: 'First Context' };
  const secondPayload = { id: 'second-context', service_name: 'Second Context' };
  let releaseFirstQuery;
  const firstQueryBlocked = new Promise((resolve) => {
    releaseFirstQuery = resolve;
  });
  const firstPool = {
    calls: 0,
    async query() {
      this.calls += 1;
      await firstQueryBlocked;
      return { rows: [{ structured_payload: firstPayload }] };
    },
  };
  const secondPool = createFakePool([{ structured_payload: secondPayload }]);

  const firstLoad = loadPublishedServices({ pool: firstPool, redis: new FakeRedis() });
  await waitImmediate();
  const secondLoad = loadPublishedServices({ pool: secondPool, redis: new FakeRedis() });
  await waitImmediate();
  releaseFirstQuery();

  const [first, second] = await Promise.all([firstLoad, secondLoad]);

  assert.deepEqual(first, [firstPayload]);
  assert.deepEqual(second, [secondPayload]);
  assert.equal(firstPool.calls, 1);
  assert.equal(secondPool.calls.length, 1);
});

test('a forced warm prevents an older cache miss from overwriting newly published content', async () => {
  const redis = new FakeRedis();
  const oldPayload = { id: 'old-service', service_name: 'Old Service' };
  const freshPayload = { id: 'fresh-service', service_name: 'Fresh Service' };
  const faqPayload = { question: 'Current FAQ', answer: 'Current answer' };
  let releaseOldQuery;
  let serviceQueries = 0;
  const oldQueryBlocked = new Promise((resolve) => {
    releaseOldQuery = resolve;
  });
  const pool = {
    async query(_text, params = []) {
      if (params[0] === 'faq') return { rows: [{ structured_payload: faqPayload }] };

      serviceQueries += 1;
      if (serviceQueries === 1) {
        await oldQueryBlocked;
        return { rows: [{ structured_payload: oldPayload }] };
      }
      return { rows: [{ structured_payload: freshPayload }] };
    },
  };

  const oldLoad = loadPublishedServices({ pool, redis });
  await waitImmediate();
  const warmed = await warmPublishedContentCache({ pool, redis });
  releaseOldQuery();
  const oldResult = await oldLoad;

  assert.deepEqual(oldResult, [oldPayload]);
  assert.deepEqual(warmed.services, [freshPayload]);
  assert.deepEqual(JSON.parse(redis.store.get('published:services')), [freshPayload]);
  assert.equal(redis.setCalls.filter((call) => call.key === 'published:services').length, 1);
});

test('loadPublishedServices retries after an initial failed cache fill', async () => {
  const redis = new FakeRedis();
  const recoveredPayload = { id: 'recovered-service', service_name: 'Recovered Service' };
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) throw new Error('PostgreSQL temporarily unavailable');
      return { rows: [{ structured_payload: recoveredPayload }] };
    },
  };

  await assert.rejects(
    loadPublishedServices({ pool, redis }),
    /PostgreSQL temporarily unavailable/,
  );
  assert.deepEqual(await loadPublishedServices({ pool, redis }), [recoveredPayload]);
  assert.equal(calls, 2);
});

test('loadPublishedServices serves stale content and throttles PostgreSQL outage retries', async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;

  try {
    const redis = createRedisClient({ redisUrl: 'memory://published-content-stale-test' });
    const lastKnownPayload = { id: 'last-known', service_name: 'Last Known Service' };
    const recoveredPayload = { id: 'recovered', service_name: 'Recovered Service' };
    let mode = 'initial';
    let calls = 0;
    const pool = {
      async query() {
        calls += 1;
        if (mode === 'outage') throw new Error('PostgreSQL unavailable');
        const payload = mode === 'recovered' ? recoveredPayload : lastKnownPayload;
        return { rows: [{ structured_payload: payload }] };
      },
    };

    assert.deepEqual(await loadPublishedServices({ pool, redis }), [lastKnownPayload]);
    now += 11 * 60 * 1000;
    mode = 'outage';
    assert.deepEqual(await loadPublishedServices({ pool, redis }), [lastKnownPayload]);

    mode = 'recovered';
    assert.deepEqual(await loadPublishedServices({ pool, redis }), [lastKnownPayload]);
    assert.equal(calls, 2);

    now += 16 * 1000;
    assert.deepEqual(await loadPublishedServices({ pool, redis }), [recoveredPayload]);
    assert.equal(calls, 3);
  } finally {
    Date.now = originalNow;
  }
});

test('warmPublishedContentCache reports a shared Redis write failure', async () => {
  const redis = {
    async get() {
      return null;
    },
    async set() {
      throw new Error('Redis unavailable');
    },
  };
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(
    warmPublishedContentCache({ pool, redis }),
    /Unable to warm shared published-content cache/,
  );
});

test('chatbot readers use fresh last-known content when a strict warm cannot write Redis', async () => {
  let releaseServiceQuery;
  const serviceQueryGate = new Promise((resolve) => {
    releaseServiceQuery = resolve;
  });
  const payload = { id: 'fresh-service', service_name: 'Fresh Service' };
  const redis = {
    async get() {
      return null;
    },
    async set() {
      throw new Error('Redis unavailable');
    },
  };
  const pool = {
    async query(_text, params = []) {
      if (params[0] === 'citizens_charter_service') await serviceQueryGate;
      return {
        rows: params[0] === 'citizens_charter_service' ? [{ structured_payload: payload }] : [],
      };
    },
  };

  const warmResult = warmPublishedContentCache({ pool, redis }).catch((error) => error);
  await waitImmediate();
  const readerResult = loadPublishedServices({ pool, redis });
  releaseServiceQuery();

  assert.deepEqual(await readerResult, [payload]);
  assert.match((await warmResult).message, /Unable to warm shared published-content cache/);
});

test('an older overlapping strict warm reports that it was superseded', async () => {
  let releaseFirstServiceQuery;
  const firstServiceQueryGate = new Promise((resolve) => {
    releaseFirstServiceQuery = resolve;
  });
  let serviceQueries = 0;
  const redis = new FakeRedis();
  const pool = {
    async query(_text, params = []) {
      if (params[0] === 'faq') return { rows: [] };

      serviceQueries += 1;
      if (serviceQueries === 1) {
        await firstServiceQueryGate;
        return { rows: [{ structured_payload: { id: 'older-service' } }] };
      }
      return { rows: [{ structured_payload: { id: 'newer-service' } }] };
    },
  };

  const olderWarm = warmPublishedContentCache({ pool, redis }).catch((error) => error);
  await waitImmediate();
  const newerWarm = warmPublishedContentCache({ pool, redis });
  assert.deepEqual((await newerWarm).services, [{ id: 'newer-service' }]);

  releaseFirstServiceQuery();
  assert.match((await olderWarm).message, /cache refresh was superseded/);
  assert.deepEqual(JSON.parse(redis.store.get('published:services')), [{ id: 'newer-service' }]);
});

test('warmPublishedContentCache refreshes service and FAQ caches from PostgreSQL', async () => {
  const redis = new FakeRedis([
    ['published:services', JSON.stringify([{ id: 'stale-service' }])],
    ['published:faqs', JSON.stringify([{ question: 'stale faq' }])],
  ]);
  const servicePayload = { id: 'current-service', service_name: 'Current Service' };
  const faqPayload = { question: 'Current FAQ', answer: 'Use the portal.' };
  const pool = {
    calls: [],
    async query(text, params = []) {
      this.calls.push({ text, params });
      if (params[0] === 'citizens_charter_service') {
        return { rows: [{ structured_payload: servicePayload }] };
      }
      if (params[0] === 'faq') return { rows: [{ structured_payload: faqPayload }] };
      throw new Error(`Unexpected params: ${params}`);
    },
  };

  const warmed = await warmPublishedContentCache({ pool, redis });

  assert.deepEqual(warmed, {
    services: [servicePayload],
    faqs: [faqPayload],
  });
  assert.deepEqual(
    pool.calls.map((call) => call.params),
    [['citizens_charter_service'], ['faq']],
  );
  assert.deepEqual(redis.setCalls, [
    {
      key: 'published:services',
      value: JSON.stringify([servicePayload]),
      options: redis.setCalls[0].options,
    },
    {
      key: 'published:faqs',
      value: JSON.stringify([faqPayload]),
      options: redis.setCalls[1].options,
    },
  ]);
  assertCacheTtl(redis.setCalls[0].options);
  assertCacheTtl(redis.setCalls[1].options);
});
