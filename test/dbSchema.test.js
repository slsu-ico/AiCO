const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');

function readSchema() {
  return fs.readFileSync(schemaPath, 'utf8');
}

function tableDefinition(schema, table) {
  const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  assert.ok(match, `Missing table ${table}`);
  return match[1];
}

function assertColumn(tableSql, column, pattern) {
  assert.match(tableSql, new RegExp(`\\b${column}\\b\\s+${pattern}`, 'i'));
}

test('schema defines the admin data tables with PostgreSQL primitives', () => {
  const schema = readSchema();

  for (const table of [
    'offices',
    'users',
    'account_requests',
    'content_items',
    'content_versions',
    'review_notes',
    'attachments',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i'));
  }

  assert.match(schema, /id\s+BIGSERIAL\s+PRIMARY KEY/i);
  assert.match(schema, /created_at\s+timestamptz\s+NOT NULL\s+DEFAULT now\(\)/i);
  assert.match(schema, /updated_at\s+timestamptz\s+NOT NULL\s+DEFAULT now\(\)/i);
  assert.match(schema, /REFERENCES offices\(id\)/i);
  assert.match(schema, /REFERENCES users\(id\)/i);
  assert.match(schema, /REFERENCES content_items\(id\)/i);
  assert.match(schema, /REFERENCES content_versions\(id\)/i);
});

test('schema constrains roles, statuses, and content types', () => {
  const schema = readSchema();

  assert.match(schema, /role\s+text\s+NOT NULL[\s\S]+CHECK\s*\(\s*role\s+IN\s*\('admin',\s*'office_user'\)\s*\)/i);
  assert.match(schema, /status\s+text\s+NOT NULL\s+DEFAULT 'pending'\s+CHECK\s*\(\s*status\s+IN\s*\('pending',\s*'approved',\s*'rejected',\s*'needs_info'\)\s*\)/i);
  assert.match(schema, /content_type\s+text\s+NOT NULL\s+CHECK\s*\(\s*content_type\s+IN\s*\('citizens_charter_service',\s*'faq',\s*'event',\s*'project',\s*'program',\s*'activity'\)\s*\)/i);
  assert.match(schema, /status\s+text\s+NOT NULL\s+DEFAULT 'draft'\s+CHECK\s*\(\s*status\s+IN\s*\('draft',\s*'pending_review',\s*'published',\s*'rejected',\s*'needs_revision',\s*'archived'\)\s*\)/i);
});

test('schema defines account request columns for office onboarding review', () => {
  const accountRequests = tableDefinition(readSchema(), 'account_requests');

  assertColumn(accountRequests, 'requested_office_name', 'text');
  assertColumn(accountRequests, 'office_id', 'bigint\\s+REFERENCES offices\\(id\\) ON DELETE SET NULL');
  assert.doesNotMatch(accountRequests, /office_id\s+bigint\s+NOT NULL/i);
  assertColumn(accountRequests, 'position', 'text\\s+NOT NULL');
  assertColumn(accountRequests, 'reason', 'text');
  assertColumn(accountRequests, 'remarks', 'text');
  assertColumn(accountRequests, 'admin_note', 'text');
  assertColumn(accountRequests, 'reviewed_by', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');
  assertColumn(accountRequests, 'reviewed_at', 'timestamptz');
});

test('schema defines content item and version columns for review workflow', () => {
  const schema = readSchema();
  const contentItems = tableDefinition(schema, 'content_items');
  const contentVersions = tableDefinition(schema, 'content_versions');

  assertColumn(contentItems, 'office_id', 'bigint\\s+NOT NULL\\s+REFERENCES offices\\(id\\) ON DELETE CASCADE');
  assertColumn(contentItems, 'current_published_version_id', 'bigint');
  assertColumn(contentItems, 'active', 'boolean\\s+NOT NULL\\s+DEFAULT true');
  assertColumn(contentItems, 'created_by', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');

  assertColumn(contentVersions, 'content_item_id', 'bigint\\s+NOT NULL\\s+REFERENCES content_items\\(id\\) ON DELETE CASCADE');
  assertColumn(contentVersions, 'version_number', 'integer\\s+NOT NULL\\s+CHECK \\(version_number > 0\\)');
  assertColumn(contentVersions, 'title', 'text\\s+NOT NULL');
  assertColumn(contentVersions, 'body', 'text');
  assertColumn(contentVersions, 'structured_payload', "jsonb\\s+NOT NULL\\s+DEFAULT '\\{\\}'::jsonb");
  assertColumn(contentVersions, 'submitted_by', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');
  assertColumn(contentVersions, 'submitted_at', 'timestamptz');
  assertColumn(contentVersions, 'reviewed_by', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');
  assertColumn(contentVersions, 'reviewed_at', 'timestamptz');
  assertColumn(contentVersions, 'published_at', 'timestamptz');
  assert.match(schema, /FOREIGN KEY\s*\(current_published_version_id\)\s+REFERENCES content_versions\(id\)/i);
});

test('schema defines review notes and generic attachment metadata', () => {
  const reviewNotes = tableDefinition(readSchema(), 'review_notes');
  const attachments = tableDefinition(readSchema(), 'attachments');

  assertColumn(reviewNotes, 'content_version_id', 'bigint\\s+NOT NULL\\s+REFERENCES content_versions\\(id\\) ON DELETE CASCADE');
  assertColumn(reviewNotes, 'reviewer_id', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');
  assertColumn(reviewNotes, 'action', 'text\\s+NOT NULL');
  assertColumn(reviewNotes, 'note', 'text');
  assertColumn(reviewNotes, 'created_at', 'timestamptz\\s+NOT NULL\\s+DEFAULT now\\(\\)');

  assertColumn(attachments, 'linked_type', 'text\\s+NOT NULL');
  assertColumn(attachments, 'linked_id', 'bigint\\s+NOT NULL');
  assertColumn(attachments, 'original_filename', 'text\\s+NOT NULL');
  assertColumn(attachments, 'file_type', 'text\\s+NOT NULL');
  assertColumn(attachments, 'file_size', 'bigint\\s+NOT NULL\\s+CHECK \\(file_size >= 0\\)');
  assertColumn(attachments, 'uploaded_by', 'bigint\\s+REFERENCES users\\(id\\) ON DELETE SET NULL');
  assertColumn(attachments, 'storage_path', 'text\\s+NOT NULL');
  assertColumn(attachments, 'created_at', 'timestamptz\\s+NOT NULL\\s+DEFAULT now\\(\\)');
});

test('schema enables row level security on admin tables for Supabase PostgREST', () => {
  const schema = readSchema();

  for (const table of [
    'offices',
    'users',
    'account_requests',
    'content_items',
    'content_versions',
    'review_notes',
    'attachments',
  ]) {
    assert.match(schema, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
  }
});

test('schema defines required lookup indexes', () => {
  const schema = readSchema();

  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_account_requests_status\s+ON account_requests\(status\)/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_users_email_active\s+ON users\(email\)\s+WHERE active = true/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_content_items_office_type\s+ON content_items\(office_id,\s*content_type\)/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_content_versions_status\s+ON content_versions\(status\)/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_content_versions_item_status\s+ON content_versions\(content_item_id,\s*status\)/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_content_versions_published\s+ON content_versions\(published_at\s+DESC,\s*id\s+DESC\)\s+WHERE status = 'published'/i);
});

test('createPool maps app config to bounded pg Pool options', () => {
  const { poolOptionsFromConfig } = require('../src/db/postgres');

  assert.deepEqual(
    poolOptionsFromConfig({
      databaseUrl: 'postgres://example/db',
      redisUrl: 'redis://cache',
      sessionSecret: 'secret',
    }),
    {
      connectionString: 'postgres://example/db',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  );

  assert.equal(poolOptionsFromConfig({ databaseUrl: 'postgres://example/db', max: 4 }).max, 4);
});

test('withTransaction commits successful callbacks and releases the client', async () => {
  const { withTransaction } = require('../src/db/postgres');
  const calls = [];
  const client = {
    async query(text) {
      calls.push(text);
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  const result = await withTransaction(pool, async (transactionClient) => {
    assert.equal(transactionClient, client);
    await transactionClient.query('SELECT 1');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.deepEqual(calls, ['connect', 'BEGIN', 'SELECT 1', 'COMMIT', 'release']);
});

test('withTransaction rolls back failed callbacks and releases the client', async () => {
  const { withTransaction } = require('../src/db/postgres');
  const calls = [];
  const expectedError = new Error('boom');
  const client = {
    async query(text) {
      calls.push(text);
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      throw expectedError;
    }),
    expectedError,
  );

  assert.deepEqual(calls, ['connect', 'BEGIN', 'ROLLBACK', 'release']);
});

test('withTransaction preserves the original error when rollback fails', async () => {
  const { withTransaction } = require('../src/db/postgres');
  const calls = [];
  const expectedError = new Error('boom');
  const rollbackError = new Error('rollback failed');
  const client = {
    async query(text) {
      calls.push(text);
      if (text === 'ROLLBACK') {
        throw rollbackError;
      }
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      throw expectedError;
    }),
    (error) => {
      assert.equal(error, expectedError);
      assert.equal(error.rollbackError || error.cause, rollbackError);
      return true;
    },
  );

  assert.deepEqual(calls, ['connect', 'BEGIN', 'ROLLBACK', 'release']);
});

test('withTransaction preserves rollback context when callbacks throw primitives', async () => {
  const { withTransaction } = require('../src/db/postgres');
  const calls = [];
  const rollbackError = new Error('rollback failed');
  const client = {
    async query(text) {
      calls.push(text);
      if (text === 'ROLLBACK') {
        throw rollbackError;
      }
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  await assert.rejects(
    withTransaction(pool, async () => {
      throw 'primitive failure';
    }),
    (error) => {
      assert.equal(error.message, 'primitive failure');
      assert.equal(error.rollbackError, rollbackError);
      assert.equal(error.originalError, 'primitive failure');
      return true;
    },
  );

  assert.deepEqual(calls, ['connect', 'BEGIN', 'ROLLBACK', 'release']);
});

test('migrate executes schema.sql inside a transaction', async () => {
  const { migrate } = require('../src/db/migrate');
  const schema = readSchema();
  const calls = [];
  const client = {
    async query(text) {
      calls.push(text);
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  await migrate(pool);

  assert.deepEqual(calls, ['connect', 'BEGIN', schema, 'COMMIT', 'release']);
});

test('migrate rolls back when schema execution fails', async () => {
  const { migrate } = require('../src/db/migrate');
  const schema = readSchema();
  const calls = [];
  const expectedError = new Error('schema failed');
  const client = {
    async query(text) {
      calls.push(text);
      if (text === schema) {
        throw expectedError;
      }
    },
    release() {
      calls.push('release');
    },
  };
  const pool = {
    async connect() {
      calls.push('connect');
      return client;
    },
  };

  await assert.rejects(migrate(pool), expectedError);

  assert.deepEqual(calls, ['connect', 'BEGIN', schema, 'ROLLBACK', 'release']);
});
