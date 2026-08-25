/**
 * Express REST API server + JTL-POS Synchronization Service.
 * Can run standalone (as a Windows service) or forked from Electron.
 *
 * Provides:
 *  - GET /api/health (MSSQL health check)
 *  - GET /api/status (Service status and info)
 *  - GET /api/logs (Live service logs with filtering)
 *  - POST /api/config/reload (Dynamic database reconnect)
 *  - JTL-POS synchronization API (/v1/init, /v1/client, /v1/product, /v1/category, /v1/order, etc.)
 */
const http = require('http');
const https = require('https');
const express = require('express');
const fs = require('fs');
const { loadConfig, CONFIG_PATH, PIPE_PATH, writeState, clearState } = require('../config');
const db = require('./db');
const cert = require('./cert');
const { logger } = require('./logger');
const { updateFirewallRules } = require('./firewall');
const { createPairingStore } = require('./jtl/pairing');
const { readCertMetadata } = require('./jtl/cert-meta');
const { createJtlPosServer } = require('./jtl/jtl-server');
const healthRoute = require('./routes/health');
const { handleCliFlags } = require('./cli-editor');

let httpServer = null;
let httpsServer = null;
let pipeServer = null;

const pairingStore = createPairingStore();

const CONSOLE_URL_MAX_LENGTH = 100;
function truncateUrl(url) {
  if (!url) return '';
  return url.length <= CONSOLE_URL_MAX_LENGTH ? url : `${url.slice(0, CONSOLE_URL_MAX_LENGTH)}...`;
}

let lastLoggedInitUrl = null;
let suppressedInitCount = 0;

function flushSuppressedInitLogs() {
  if (suppressedInitCount > 0) {
    logger.info(`Suppressed ${suppressedInitCount} duplicate init log(s)`);
    suppressedInitCount = 0;
  }
}

function formatBody(buffer) {
  if (!buffer || !buffer.length) {
    return '(empty)';
  }
  const text = buffer.toString('utf8');
  if (/^[\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]*$/.test(text)) {
    return text;
  }
  return `[binary ${buffer.length} bytes]`;
}

async function start() {
  const config = loadConfig();
  if (config.logging?.logBody || config.logBody || config.logging?.verbose || config.verbose) {
    logger.setLogBody(true);
  }
  if (config.logging?.logResponse || config.logResponse || config.logging?.verbose || config.verbose) {
    logger.setLogResponse(true);
  }
  if (logger.isLogBodyEnabled()) {
    logger.info('Verbose request / POST body logging is ENABLED (--log-body / --log-req / LOG_BODY=1)');
  }
  if (logger.isLogResponseEnabled()) {
    logger.info('Verbose response text logging is ENABLED (--log-response / --log-res / LOG_RESPONSE=1)');
  }
  const app = express();

  // Load / Generate TLS certificate
  let tlsCreds = cert.loadCert();
  if (!tlsCreds) {
    logger.info('No TLS certificate found — generating self-signed cert…');
    tlsCreds = await cert.generateCert();
  }
  const certMeta = readCertMetadata(tlsCreds.cert);

  // Setup JTL handler
  const authToken = config.auth?.authToken || process.env.AUTH_TOKEN || '';
  const jtlHandler = createJtlPosServer(pairingStore, {
    authToken,
    ...certMeta,
  });

  // Logging & Timing Middleware
  app.use((req, res, next) => {
    const started = Date.now();
    let responseBuffer = Buffer.alloc(0);

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = (chunk, ...args) => {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBuffer = Buffer.concat([responseBuffer, buf]);
      }
      return originalWrite(chunk, ...args);
    };

    res.end = (chunk, ...args) => {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBuffer = Buffer.concat([responseBuffer, buf]);
      }
      res.on('finish', () => {
        const durationMs = Date.now() - started;
        const responseBody = formatBody(responseBuffer);
        const isInit = (req.originalUrl || req.url).startsWith('/api/v1/init') || (req.originalUrl || req.url).startsWith('/v1/init');

        if (isInit) {
          if (lastLoggedInitUrl === (req.originalUrl || req.url)) {
            suppressedInitCount++;
            return;
          }
          lastLoggedInitUrl = req.originalUrl || req.url;
        } else {
          flushSuppressedInitLogs();
          lastLoggedInitUrl = null;
        }

        logger.logRequest({
          remoteAddress: req.socket?.remoteAddress,
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: res.statusCode,
          durationMs,
          response: responseBody,
        });
      });

      return originalEnd(chunk, ...args);
    };

    next();
  });

  // Body parsing for JSON
  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: '*/*', limit: '50mb' }));

  // --- Management & Health Routes ---
  app.use(healthRoute);

  // --- Reload endpoint ---
  app.post('/api/config/reload', async (_req, res) => {
    try {
      await db.reloadIfChanged();
      logger.success('Database configuration reloaded via API');
      res.json({ status: 'ok', message: 'Database configuration reloaded' });
    } catch (err) {
      db.startReconnectLoop(10000);
      logger.error(`Database reload failed: ${err.message}`);
      res.status(500).json({ status: 'error', error: err.message });
    }
  });

  // --- Status endpoint ---
  app.get('/api/status', (_req, res) => {
    const pairingState = pairingStore.getPairingState();
    res.json({
      service: 'QuixPOS2JTL',
      status: 'running',
      database: db.isConnected() ? 'connected' : 'connecting',
      pid: process.pid,
      uptime: process.uptime(),
      httpPort: config.network?.httpPort || 8087,
      httpsPort: config.network?.httpsPort || 4447,
      pipe: PIPE_PATH,
      pairingCode: pairingState.pairingCodes[0]?.code || null,
      fingerprint: certMeta.serverFingerprint,
    });
  });

  // --- Logs endpoint ---
  app.get('/api/logs', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const limit = parseInt(req.query.limit, 10) || 200;
    const level = req.query.level || null;
    const logs = logger.getRecentLogs(since, limit, level);
    res.json({ logs });
  });

  app.delete('/api/logs', (_req, res) => {
    logger.clearMemoryLogs();
    res.json({ status: 'ok', message: 'Logs cleared' });
  });

  // --- Pairing management endpoints ---
  app.get('/api/pairing', (_req, res) => {
    res.json({ success: true, ...pairingStore.getPairingState() });
  });

  app.post('/api/pairing/generate', (req, res) => {
    const name = req.body?.name || req.query?.name || 'JTL-POS';
    const entry = pairingStore.generatePairingCode(name);
    res.json({ success: true, ...entry });
  });

  app.post('/api/pairing/pin', (req, res) => {
    const code = req.body?.code || req.body?.pin || req.query?.code || req.query?.pin;
    const name = req.body?.name || req.query?.name || 'JTL-POS';
    if (!code) {
      const entry = pairingStore.generatePairingCode(name);
      return res.json({ success: true, ...entry });
    }
    pairingStore.setPairingCode(code, name);
    res.json({ success: true, code: String(code).trim(), name });
  });

  app.delete('/api/pairing/pin', (_req, res) => {
    pairingStore.revokePairingCode();
    res.json({ success: true, message: 'Pairing PIN revoked' });
  });

  app.delete('/api/pairing/devices/:token', (req, res) => {
    pairingStore.removePairedDevice(req.params.token);
    res.json({ success: true, message: 'Paired device removed' });
  });

  // --- JTL-POS Handler Middleware (handles /v1/*, /api/v1/*, OPTIONS, etc.) ---
  app.use(async (req, res, next) => {
    const path = req.path;
    if (
      path.startsWith('/v1/') ||
      path.startsWith('/api/v1/') ||
      path === '/v1' ||
      path === '/api/v1' ||
      req.method === 'OPTIONS'
    ) {
      try {
        await jtlHandler(req, res);
      } catch (err) {
        logger.error(`JTL handler error on ${req.method} ${path}: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ Message: err.message });
        }
      }
    } else {
      next();
    }
  });

  // --- Root fallback ---
  app.get('/', (_req, res) => {
    res.json({
      service: 'QuixPOS2JTL',
      status: 'running',
      jtlPosSync: 'active',
      endpoints: [
        '/health',
        '/api/health',
        '/api/status',
        '/api/logs',
        '/api/v1/init',
        '/api/v1/client',
        '/api/v1/product',
        '/api/v1/category',
        '/api/v1/order',
      ],
    });
  });

  // --- Start HTTP Server ---
  const httpPort = config.network?.httpPort || 8087;
  httpServer = http.createServer(app);
  httpServer.listen(httpPort, '0.0.0.0', () => {
    logger.success(`HTTP server listening on http://0.0.0.0:${httpPort}`);
  });

  // --- Start HTTPS Server ---
  const httpsPort = config.network?.httpsPort || 4447;
  httpsServer = https.createServer({ cert: tlsCreds.cert, key: tlsCreds.key }, app);
  httpsServer.listen(httpsPort, '0.0.0.0', () => {
    logger.success(`HTTPS POS server listening on https://0.0.0.0:${httpsPort}`);
  });

  // --- Ensure Windows Firewall is open for configured ports ---
  updateFirewallRules(httpPort, httpsPort);

  // --- Named Pipe / Unix Domain Socket Server ---
  try {
    if (process.platform !== 'win32' && fs.existsSync(PIPE_PATH)) {
      try { fs.unlinkSync(PIPE_PATH); } catch {}
    }
    pipeServer = http.createServer(app);
    pipeServer.listen(PIPE_PATH, () => {
      logger.info(`IPC listener active on ${PIPE_PATH}`);
    });
    pipeServer.on('error', (err) => {
      logger.warn(`IPC listener note: ${err.message}`);
    });
  } catch (err) {
    logger.warn(`IPC listener setup note: ${err.message}`);
  }

  // --- Publish Runtime State & Listeners ---
  const runtimeStartedAt = new Date().toISOString();
  function updateRuntimeState(dbStatus = 'connecting') {
    writeState({
      pid: process.pid,
      status: 'running',
      database: dbStatus,
      startedAt: runtimeStartedAt,
      httpPort,
      httpsPort,
      pipe: PIPE_PATH,
    });
    if (process.send) {
      process.send({ type: 'db-status', database: dbStatus, httpPort, httpsPort, pipe: PIPE_PATH });
    }
  }

  db.setConnectionStateListener((state) => {
    updateRuntimeState(state);
  });

  updateRuntimeState('connecting');

  // --- Connect Database ---
  try {
    await db.connect();
  } catch (err) {
    logger.warn(`Initial database connection note: ${err.message}`);
    db.startReconnectLoop(10000);
  }

  // --- Watch Config File For Live Reloading ---
  setupConfigFileWatcher();

  // --- CLI pairing PIN flag ---
  const pinArgIndex = process.argv.findIndex((arg) => arg === '--pin' || arg === '--newpin' || arg === '--generate-pin');
  const pinEqualArg = process.argv.find((arg) => arg.startsWith('--pin=') || arg.startsWith('--newpin='));

  if (pinEqualArg) {
    const explicitPin = pinEqualArg.split('=')[1]?.trim();
    if (explicitPin) {
      pairingStore.setPairingCode(explicitPin, 'JTL-POS');
      logger.success(`Set active pairing PIN: ${explicitPin} (ready for JTL-POS pairing)`);
    } else {
      const pinEntry = pairingStore.generatePairingCode('JTL-POS');
      logger.success(`Generated pairing PIN: ${pinEntry.code} (ready for JTL-POS pairing)`);
    }
  } else if (pinArgIndex !== -1) {
    const nextArg = process.argv[pinArgIndex + 1];
    if (nextArg && !nextArg.startsWith('-')) {
      pairingStore.setPairingCode(nextArg, 'JTL-POS');
      logger.success(`Set active pairing PIN: ${nextArg} (ready for JTL-POS pairing)`);
    } else {
      const pinEntry = pairingStore.generatePairingCode('JTL-POS');
      logger.success(`Generated pairing PIN: ${pinEntry.code} (ready for JTL-POS pairing)`);
    }
  } else {
    const activePin = pairingStore.getPairingState().pairingCodes[0]?.code;
    if (activePin) {
      logger.info(`Active pairing PIN: ${activePin} (ready for JTL-POS pairing)`);
    }
  }

  // Notify parent (Electron) if forked
  if (process.send) {
    process.send({ type: 'started', httpPort, httpsPort, pipe: PIPE_PATH });
  }
}

let configWatchDebounce = null;
function setupConfigFileWatcher() {
  try {
    fs.watchFile(CONFIG_PATH, { interval: 1000 }, async (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        clearTimeout(configWatchDebounce);
        configWatchDebounce = setTimeout(async () => {
          try {
            logger.info('Detected config.json change on disk — updating database connection…');
            await db.reloadIfChanged();
          } catch (err) {
            logger.warn(`Database reconnect on config change: ${err.message}`);
            db.startReconnectLoop(10000);
          }
        }, 300);
      }
    });
  } catch (err) {
    logger.warn(`Config watcher error: ${err.message}`);
  }
}

async function stop() {
  logger.info('Shutting down service…');
  clearState();
  await db.disconnect();
  logger.close();
  if (httpServer) httpServer.close();
  if (httpsServer) httpsServer.close();
  if (pipeServer) pipeServer.close();
}

// IPC from Electron parent
process.on('message', async (msg) => {
  if (msg === 'stop' || (msg && msg.type === 'stop')) {
    await stop();
    process.exit(0);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => { await stop(); process.exit(0); });
process.on('SIGINT', async () => { await stop(); process.exit(0); });

// Auto-start when executed directly
(async () => {
  try {
    const shouldStart = await handleCliFlags();
    if (shouldStart) {
      await start();
    }
  } catch (err) {
    console.error('Fatal error starting service:', err);
    process.exit(1);
  }
})();
