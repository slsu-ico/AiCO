const services = require('../../data/services.json');
const { getConfig } = require('../config');
const { hashPassword } = require('../passwordHash');
const { createPool, withTransaction } = require('./postgres');

const ICO_OFFICE_NAME = 'Information and Communications Office';
const ICO_OFFICE_ABBREVIATION = 'ICO';
const SERVICE_CONTENT_TYPE = 'citizens_charter_service';
const SEED_LOCK_KEY = 'seed:initial-data';

function requireBootstrapAdminPassword(password) {
  if (typeof password !== 'string' || password.trim() === '') {
    throw new Error('bootstrapAdminPassword is required to seed the bootstrap admin account.');
  }
}

async function ensureIcoOffice(client) {
  const result = await client.query(
    `
      WITH existing AS (
        SELECT id
        FROM offices
        WHERE abbreviation = $2
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO offices (name, abbreviation)
        SELECT $1, $2
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id
      )
      SELECT id FROM inserted
      UNION ALL
      SELECT id FROM existing
      LIMIT 1
    `,
    [ICO_OFFICE_NAME, ICO_OFFICE_ABBREVIATION],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to seed ICO office.');
  }

  return result.rows[0].id;
}

async function ensureBootstrapAdmin(client, officeId, options) {
  const existing = await client.query(
    `
      SELECT id
      FROM users
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    [options.bootstrapAdminEmail],
  );

  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
      INSERT INTO users (office_id, email, password_hash, full_name, role, active)
      VALUES ($1, $2, $3, $4, 'admin', true)
      RETURNING id
    `,
    [
      officeId,
      options.bootstrapAdminEmail,
      hashPassword(options.bootstrapAdminPassword),
      options.bootstrapAdminFullName || 'Bootstrap Administrator',
    ],
  );

  return inserted.rows[0].id;
}

async function findExistingPublishedService(client, officeId, serviceId) {
  const result = await client.query(
    `
      SELECT ci.id
      FROM content_items ci
      JOIN content_versions cv ON cv.id = ci.current_published_version_id
      WHERE ci.office_id = $1
        AND ci.content_type = $2
        AND cv.status = 'published'
        AND cv.structured_payload->>'id' = $3
      LIMIT 1
    `,
    [officeId, SERVICE_CONTENT_TYPE, serviceId],
  );

  return result.rows[0] || null;
}

async function insertPublishedService(client, officeId, adminId, service) {
  const item = await client.query(
    `
      INSERT INTO content_items (office_id, content_type, active, created_by)
      VALUES ($1, $2, true, $3)
      RETURNING id
    `,
    [officeId, SERVICE_CONTENT_TYPE, adminId],
  );
  const itemId = item.rows[0].id;

  const version = await client.query(
    `
      INSERT INTO content_versions (
        content_item_id,
        version_number,
        status,
        title,
        body,
        structured_payload,
        submitted_by,
        submitted_at,
        reviewed_by,
        reviewed_at,
        published_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now(), $8, now(), now())
      RETURNING id
    `,
    [
      itemId,
      1,
      'published',
      service.service_name,
      service.description || '',
      service,
      adminId,
      adminId,
    ],
  );
  const versionId = version.rows[0].id;

  await client.query(
    `
      UPDATE content_items
      SET current_published_version_id = $1,
          updated_at = now()
      WHERE id = $2
    `,
    [versionId, itemId],
  );
}

async function seedInitialData(pool, options = {}) {
  const config = {
    ...getConfig(),
    ...options,
  };
  requireBootstrapAdminPassword(config.bootstrapAdminPassword);

  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SEED_LOCK_KEY]);

    const officeId = await ensureIcoOffice(client);
    const adminId = await ensureBootstrapAdmin(client, officeId, config);
    let servicesImported = 0;
    let servicesSkipped = 0;

    for (const service of services) {
      const existing = await findExistingPublishedService(client, officeId, service.id);
      if (existing) {
        servicesSkipped += 1;
        continue;
      }

      await insertPublishedService(client, officeId, adminId, service);
      servicesImported += 1;
    }

    return {
      officeId,
      adminId,
      servicesImported,
      servicesSkipped,
    };
  });
}

async function run() {
  const config = getConfig();
  const pool = createPool({ databaseUrl: config.databaseUrl });

  try {
    await seedInitialData(pool, config);
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
  seedInitialData,
};
