const { Pool } = require('pg');

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MILLIS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 5000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function poolOptionsFromConfig(config = {}) {
  const options = {
    connectionString: config.databaseUrl ?? config.connectionString,
    max: positiveInteger(config.max ?? config.poolMax, DEFAULT_POOL_MAX),
    idleTimeoutMillis: positiveInteger(config.idleTimeoutMillis, DEFAULT_IDLE_TIMEOUT_MILLIS),
    connectionTimeoutMillis: positiveInteger(
      config.connectionTimeoutMillis,
      DEFAULT_CONNECTION_TIMEOUT_MILLIS,
    ),
  };

  if (config.ssl !== undefined) options.ssl = config.ssl;
  if (config.application_name !== undefined) options.application_name = config.application_name;
  if (config.statement_timeout !== undefined) options.statement_timeout = config.statement_timeout;
  if (config.query_timeout !== undefined) options.query_timeout = config.query_timeout;

  return options;
}

function createPool(config = {}) {
  return new Pool(poolOptionsFromConfig(config));
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
  poolOptionsFromConfig,
  query,
  withTransaction,
};
