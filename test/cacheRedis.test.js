const assert = require('node:assert/strict');
const test = require('node:test');

const { createRedisClient, getJson, setJson } = require('../src/cache/redis');

test('memory Redis expires values written with a JSON TTL', async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;

  try {
    const redis = createRedisClient({ redisUrl: 'memory://ttl-test' });

    await setJson(redis, 'short-lived', { available: true }, { ttlSeconds: 2 });
    assert.deepEqual(await getJson(redis, 'short-lived'), { available: true });

    now += 2_001;
    assert.equal(await getJson(redis, 'short-lived'), null);
    assert.equal(await redis.del('short-lived'), 0);
  } finally {
    Date.now = originalNow;
  }
});

test('memory Redis honors NX until the existing value expires', async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;

  try {
    const redis = createRedisClient({ redisUrl: 'memory://nx-test' });
    const options = {
      condition: 'NX',
      expiration: { type: 'EX', value: 5 },
    };

    assert.equal(await redis.set('event:123', 'first', options), 'OK');
    assert.equal(await redis.set('event:123', 'duplicate', options), null);
    assert.equal(await redis.get('event:123'), 'first');

    now += 5_001;
    assert.equal(await redis.set('event:123', 'after-expiry', options), 'OK');
    assert.equal(await redis.get('event:123'), 'after-expiry');
  } finally {
    Date.now = originalNow;
  }
});
