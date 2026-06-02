const { Pool } = require('pg');

function createPool(config = {}) {
  return new Pool({
    connectionString: config.databaseUrl,
    ...config,
  });
}

function query(pool, text, params) {
  return pool.query(text, params);
}

function normalizeRollbackFailure(error, rollbackError) {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    error.rollbackError = rollbackError;
    return error;
  }

  const wrappedError = new Error(String(error));
  wrappedError.originalError = error;
  wrappedError.rollbackError = rollbackError;
  return wrappedError;
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw normalizeRollbackFailure(error, rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPool,
  query,
  withTransaction,
};
