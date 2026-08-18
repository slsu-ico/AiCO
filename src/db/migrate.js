const fs = require('node:fs/promises');
const path = require('node:path');

const { getConfig } = require('../config');
const { normalizeContentPayload } = require('../contentPayload');
const { createPool, withTransaction } = require('./postgres');

const schemaPath = path.join(__dirname, 'schema.sql');

async function auditPublishedChatbotContent(client) {
  const result = await client.query(`
    SELECT ci.id AS content_item_id,
           ci.content_type,
           cv.id AS content_version_id,
           cv.structured_payload
    FROM content_items ci
    JOIN content_versions cv ON cv.id = ci.current_published_version_id
    WHERE ci.active = true
      AND cv.status = 'published'
      AND ci.content_type IN ('citizens_charter_service', 'faq')
    ORDER BY ci.id
  `);
  const serviceIds = new Set();

  for (const row of result.rows) {
    let payload;
    try {
      payload = normalizeContentPayload(row.content_type, row.structured_payload);
    } catch (error) {
      const auditError = new Error(
        `Published chatbot content item ${row.content_item_id} (version ${row.content_version_id}) is invalid: ${error.message}`,
      );
      auditError.cause = error;
      throw auditError;
    }

    if (row.content_type === 'citizens_charter_service') {
      if (serviceIds.has(payload.id)) {
        throw new Error(`Published chatbot service ID is duplicated: ${payload.id}`);
      }
      serviceIds.add(payload.id);
    }
  }
}

async function migrate(pool) {
  const schema = await fs.readFile(schemaPath, 'utf8');
  await withTransaction(pool, async (client) => {
    await client.query(schema);
    await auditPublishedChatbotContent(client);
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
  auditPublishedChatbotContent,
  migrate,
};
