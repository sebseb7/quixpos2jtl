/**
 * MSSQL database connection manager.
 * Uses the shared config for connection parameters.
 */
const sql = require('mssql');
const { loadConfig } = require('../config');
const { fetchActiveShop } = require('./jtl/shop');
const { logger } = require('./logger');

let pool = null;
let currentDbConfigJson = '';

/**
 * Build a mssql config object from our app config.
 */
function buildSqlConfig(dbCfg) {
  return {
    server: dbCfg.server || 'localhost',
    port: parseInt(dbCfg.port, 10) || 1433,
    database: dbCfg.database || '',
    user: dbCfg.user || '',
    password: dbCfg.password || '',
    options: {
      encrypt: !!dbCfg.encrypt,
      trustServerCertificate: dbCfg.trustServerCertificate !== false,
    },
    connectionTimeout: 10000,
    requestTimeout: 30000,
  };
}

/**
 * Connect (or reconnect) to the database using the latest or provided config.
 */
async function connect(dbCfgOverride) {
  const config = dbCfgOverride || loadConfig().db;
  currentDbConfigJson = JSON.stringify(config);

  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
  }

  if (!config || !config.server || !config.database) {
    throw new Error('Database server or database name is not configured.');
  }

  const sqlConfig = buildSqlConfig(config);
  pool = await sql.connect(sqlConfig);
  logger.success(`MSSQL connected: ${config.server}:${config.port || 1433}/${config.database}`);

  // Auto-initialize active shop ID
  try {
    const shopId = await fetchActiveShop(pool);
    logger.info(`Active JTL shop ID: ${shopId}`);
  } catch (err) {
    logger.warn(`Could not fetch active shop ID: ${err.message}`);
  }

  return pool;
}

/**
 * Reload database connection if config has changed.
 */
async function reloadIfChanged() {
  const config = loadConfig().db;
  const newJson = JSON.stringify(config);
  if (newJson !== currentDbConfigJson || !pool) {
    return await connect(config);
  }
  return pool;
}

/**
 * Close the connection pool.
 */
async function disconnect() {
  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
  }
}

/**
 * Get the current pool (throws if not connected).
 */
function getPool() {
  if (!pool) {
    throw new Error('MSSQL pool is not connected.');
  }
  return pool;
}

/**
 * Health check — runs SELECT GETDATE() and returns the result.
 * If not connected, attempts to connect with latest config first.
 */
async function healthCheck() {
  if (!pool) {
    await connect();
  }
  const result = await pool.request().query('SELECT GETDATE() AS currentDate');
  return result.recordset[0].currentDate;
}

/**
 * Ping database (returns true if healthy).
 */
async function pingDb() {
  try {
    const result = await getPool().request().query('SELECT 1 AS ok');
    return result.recordset[0]?.ok === 1;
  } catch {
    return false;
  }
}

module.exports = {
  connect,
  reloadIfChanged,
  disconnect,
  getPool,
  healthCheck,
  pingDb,
};
