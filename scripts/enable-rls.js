const { getConfig } = require('../src/config');
const { createPool, query } = require('../src/db/postgres');

const TABLES = [
  'offices',
  'users',
  'account_requests',
  'content_items',
  'content_versions',
  'review_notes',
  'attachments',
];

async function enableRls(pool) {
  for (const table of TABLES) {
    await query(pool, `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    console.log(`RLS enabled on ${table}`);
  }
}

async function run() {
  const { databaseUrl } = getConfig();
  if (!databaseUrl || databaseUrl.includes('localhost')) {
    throw new Error(
      'Set DATABASE_URL to your Supabase Postgres URI before running enable-rls (Project Settings → Database → Connection string).',
    );
  }

  const pool = createPool({ databaseUrl });
  try {
    await enableRls(pool);
    console.log('Done. Refresh Supabase Security Advisor to confirm.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { enableRls, TABLES };
