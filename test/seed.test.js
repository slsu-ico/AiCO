const assert = require('node:assert/strict');
const test = require('node:test');

const services = require('../data/services.json');
const { seedInitialData } = require('../src/db/seed');

function createFakePool(handler) {
  const calls = [];
  const client = {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return handler(text, params, calls);
    },
    release() {
      calls.push({ text: 'release', params: [] });
    },
  };

  return {
    client,
    async connect() {
      calls.push({ text: 'connect', params: [] });
      return client;
    },
  };
}

function commandCalls(pool) {
  return pool.client.calls.map((call) => call.text);
}

function sqlIncludes(text, expected) {
  return text.replace(/\s+/g, ' ').includes(expected);
}

test('seedInitialData requires a non-empty bootstrap admin password before opening a transaction', async () => {
  const pool = createFakePool(() => {
    throw new Error('query should not run');
  });

  await assert.rejects(
    seedInitialData(pool, { bootstrapAdminPassword: '   ' }),
    /bootstrapAdminPassword is required/i,
  );

  assert.deepEqual(pool.client.calls, []);
});

test('seedInitialData inserts ICO office, bootstrap admin, and published service content', async () => {
  let nextItemId = 100;
  let nextVersionId = 500;
  const insertedPayloads = [];
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO offices')) return { rows: [{ id: 10 }] };
    if (sqlIncludes(text, 'SELECT id FROM users')) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO users')) return { rows: [{ id: 20 }] };
    if (text.includes("structured_payload->>'id'")) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO content_items')) return { rows: [{ id: nextItemId++ }] };
    if (sqlIncludes(text, 'INSERT INTO content_versions')) {
      insertedPayloads.push(params[5]);
      return { rows: [{ id: nextVersionId++ }] };
    }
    if (sqlIncludes(text, 'UPDATE content_items')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const result = await seedInitialData(pool, {
    bootstrapAdminEmail: 'bootstrap@example.edu',
    bootstrapAdminPassword: 'Secret123!',
  });

  assert.deepEqual(commandCalls(pool).slice(0, 2), ['connect', 'BEGIN']);
  assert.equal(commandCalls(pool).at(-2), 'COMMIT');
  assert.equal(commandCalls(pool).at(-1), 'release');
  assert.equal(result.officeId, 10);
  assert.equal(result.adminId, 20);
  assert.equal(result.servicesImported, services.length);
  assert.equal(insertedPayloads.length, services.length);
  assert.deepEqual(
    insertedPayloads.map((payload) => payload.id),
    services.map((service) => service.id),
  );

  const officeInsert = pool.client.calls.find((call) =>
    sqlIncludes(call.text, 'INSERT INTO offices'),
  );
  assert.deepEqual(officeInsert.params, ['Information and Communications Office', 'ICO']);

  const adminInsert = pool.client.calls.find((call) => sqlIncludes(call.text, 'INSERT INTO users'));
  assert.equal(adminInsert.params[0], 10);
  assert.equal(adminInsert.params[1], 'bootstrap@example.edu');
  assert.match(adminInsert.params[2], /^scrypt:v1:N=16384,r=8,p=1,keylen=64:/);
  assert.notEqual(adminInsert.params[2], 'Secret123!');
  assert.equal(adminInsert.params[3], 'Bootstrap Administrator');

  const lockCall = pool.client.calls.find((call) =>
    sqlIncludes(call.text, 'pg_advisory_xact_lock'),
  );
  assert.ok(lockCall);
  assert.deepEqual(lockCall.params, ['seed:initial-data']);

  const serviceLookups = pool.client.calls.filter((call) =>
    call.text.includes("structured_payload->>'id'"),
  );
  assert.equal(serviceLookups.length, services.length);
  assert.ok(serviceLookups.every((call) => call.params[1] === 'citizens_charter_service'));

  const itemInserts = pool.client.calls.filter((call) =>
    sqlIncludes(call.text, 'INSERT INTO content_items'),
  );
  assert.equal(itemInserts.length, services.length);
  assert.ok(itemInserts.every((call) => call.params[1] === 'citizens_charter_service'));
});

test('seedInitialData skips services that already have a published payload id', async () => {
  const existingServiceId = services[0].id;
  const pool = createFakePool(async (text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO offices')) return { rows: [{ id: 10 }] };
    if (sqlIncludes(text, 'SELECT id FROM users')) return { rows: [{ id: 20 }] };
    if (text.includes("structured_payload->>'id'")) {
      return params[2] === existingServiceId ? { rows: [{ id: 999 }] } : { rows: [] };
    }
    if (sqlIncludes(text, 'INSERT INTO content_items')) return { rows: [{ id: 100 }] };
    if (sqlIncludes(text, 'INSERT INTO content_versions')) return { rows: [{ id: 500 }] };
    if (sqlIncludes(text, 'UPDATE content_items')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const result = await seedInitialData(pool, {
    bootstrapAdminEmail: 'bootstrap@example.edu',
    bootstrapAdminPassword: 'Secret123!',
  });

  const versionInserts = pool.client.calls.filter((call) =>
    sqlIncludes(call.text, 'INSERT INTO content_versions'),
  );
  assert.equal(result.servicesSkipped, 1);
  assert.equal(result.servicesImported, services.length - 1);
  assert.equal(versionInserts.length, services.length - 1);
});

test('seedInitialData is idempotent when every service already exists', async () => {
  const pool = createFakePool(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (sqlIncludes(text, 'SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO offices')) return { rows: [{ id: 10 }] };
    if (sqlIncludes(text, 'SELECT id FROM users')) return { rows: [{ id: 20 }] };
    if (text.includes("structured_payload->>'id'")) return { rows: [{ id: 999 }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const result = await seedInitialData(pool, {
    bootstrapAdminEmail: 'bootstrap@example.edu',
    bootstrapAdminPassword: 'Secret123!',
  });

  assert.equal(result.servicesSkipped, services.length);
  assert.equal(result.servicesImported, 0);
  assert.equal(
    pool.client.calls.filter((call) => sqlIncludes(call.text, 'INSERT INTO content_versions'))
      .length,
    0,
  );
  assert.equal(commandCalls(pool).at(-2), 'COMMIT');
  assert.equal(commandCalls(pool).at(-1), 'release');
});

test('seedInitialData rolls back and releases the client when service import fails', async () => {
  const failure = new Error('content insert failed');
  const pool = createFakePool(async (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
    if (text === 'COMMIT') throw new Error('commit should not run');
    if (sqlIncludes(text, 'SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO offices')) return { rows: [{ id: 10 }] };
    if (sqlIncludes(text, 'SELECT id FROM users')) return { rows: [{ id: 20 }] };
    if (text.includes("structured_payload->>'id'")) return { rows: [] };
    if (sqlIncludes(text, 'INSERT INTO content_items')) throw failure;
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await assert.rejects(
    seedInitialData(pool, {
      bootstrapAdminEmail: 'bootstrap@example.edu',
      bootstrapAdminPassword: 'Secret123!',
    }),
    failure,
  );

  assert.equal(commandCalls(pool).at(-2), 'ROLLBACK');
  assert.equal(commandCalls(pool).at(-1), 'release');
});
