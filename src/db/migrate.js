const fs = require('node:fs/promises');
const path = require('node:path');

const { getConfig } = require('../config');
const { createPool, withTransaction } = require('./postgres');

const schemaPath = path.join(__dirname, 'schema.sql');

async function migrate(pool) {
  const schema = await fs.readFile(schemaPath, 'utf8');
  await withTransaction(pool, async (client) => {
    await client.query(schema);
  });
}

async function run() {
  const pool = createPool({ databaseUrl: getConfig().databaseUrl });

  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  migrate,
};
