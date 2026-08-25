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
let reconnectTimer = null;
let onConnectionStateChange = null;

function setConnectionStateListener(listener) {
  onConnectionStateChange = listener;
}

function notifyConnectionState(state) {
  if (typeof onConnectionStateChange === 'function') {
    try {
      onConnectionStateChange(state);
    } catch {
      // ignore
    }
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

function startReconnectLoop(intervalMs = 10000) {
  notifyConnectionState('connecting');
  if (reconnectTimer) return; // already active
  reconnectTimer = setInterval(async () => {
    try {
      await connect();
    } catch (err) {
      notifyConnectionState('connecting');
      logger.warn(`Database reconnect retry failed: ${err.message}`);
    }
  }, intervalMs);
  if (reconnectTimer.unref) {
    reconnectTimer.unref();
  }
}

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

  try {
    const sqlConfig = buildSqlConfig(config);
    const newPool = await sql.connect(sqlConfig);

    newPool.on('error', (err) => {
      logger.warn(`Database connection pool error: ${err.message}`);
      pool = null;
      notifyConnectionState('connecting');
      startReconnectLoop(10000);
    });

    pool = newPool;
    clearReconnectTimer();
    notifyConnectionState('connected');
    logger.success(`MSSQL connected: ${config.server}:${config.port || 1433}/${config.database}`);

    // Auto-initialize active shop ID and derived parameters
    try {
      const shopId = await fetchActiveShop(pool);
      const { getActiveShopDetails } = require('./jtl/shop');
      const details = getActiveShopDetails();
      if (shopId && details) {
        logger.info(`Active JTL POS shop: #${shopId} "${details.cName}" (Steuerzone: ${details.kSteuerzone ?? 'none'}, Warenlager: ${details.kWarenlager ?? 'none'}, Sprache: ${details.kSprache ?? 'none'}, Root-Kat: ${details.kKategorie ?? 'none'})`);
      } else {
        logger.warn('JTL POS Shop is not configured. Please configure kShop in settings.');
      }
    } catch (err) {
      logger.warn(`Could not load active shop: ${err.message}`);
    }

    return pool;
  } catch (err) {
    notifyConnectionState('connecting');
    throw err;
  }
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
  clearReconnectTimer();
  notifyConnectionState('disconnected');
  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
  }
}

/**
 * Check if pool is currently connected.
 */
function isConnected() {
  return !!(pool && pool.connected);
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
  try {
    const result = await pool.request().query('SELECT GETDATE() AS currentDate');
    return result.recordset[0].currentDate;
  } catch (err) {
    if (pool) {
      try { await pool.close(); } catch { /* ignore */ }
      pool = null;
    }
    startReconnectLoop(10000);
    throw err;
  }
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
  isConnected,
  getPool,
  healthCheck,
  pingDb,
  startReconnectLoop,
  clearReconnectTimer,
  setConnectionStateListener,
};
