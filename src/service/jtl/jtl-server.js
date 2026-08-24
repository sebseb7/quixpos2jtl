const { endpoints } = require('./endpoints');
const { normalizePath, readBody, sendCorsPreflight, sendJson } = require('./http');
const { loadConfig } = require('../../config');
const { logger } = require('../logger');

function buildConfig(config = {}) {
  const cfg = loadConfig();
  const envVal = String(process.env.NEWPIN_ENABLED ?? '').trim().toLowerCase();
  const isNewPinExplicitlyDisabled = envVal === 'false' || envVal === '0';
  const newPinEnabled = config.newPinEnabled !== undefined
    ? Boolean(config.newPinEnabled)
    : !isNewPinExplicitlyDisabled;

  return {
    authToken: config.authToken || cfg.auth?.authToken || process.env.AUTH_TOKEN || '',
    certificateFingerprint: config.certificateFingerprint || '',
    certificateSerialNumber: config.certificateSerialNumber || '',
    serverFingerprint: config.serverFingerprint || '',
    mandantId: config.mandantId || cfg.shop?.mandantId || process.env.MANDANT_ID || '1',
    mandantName: config.mandantName || cfg.shop?.mandantName || process.env.MANDANT_NAME || 'eB-Standard',
    mandantDatabase: config.mandantDatabase || cfg.shop?.mandantDatabase || cfg.db?.database || process.env.MANDANT_DATABASE || 'eazybusiness',
    newPinEnabled,
  };
}

function createJtlPosServer(pairingStore, config = {}) {
  const resolvedConfig = buildConfig(config);
  const routes = new Map(endpoints.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint]));

  async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      return sendCorsPreflight(res);
    }

    const url = new URL(req.url, 'https://localhost');
    const pathname = normalizePath(url.pathname);
    const routeKey = `${req.method} ${pathname}`;
    const endpoint = routes.get(routeKey);

    if (endpoint) {
      return await endpoint.handle(req, res, { url, pairingStore, config: resolvedConfig });
    }

    return sendJson(res, 404, {
      Message: `No HTTP resource was found that matches the request URI '${url}'.`,
    });
  }

  return async function requestListener(req, res) {
    req.rawBody = await readBody(req);
    if (logger.isLogBodyEnabled() && req.method !== 'GET' && req.method !== 'OPTIONS' && req.rawBody?.length) {
      const text = req.rawBody.toString('utf8');
      let bodyFormatted = text;
      try {
        bodyFormatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // keep text
      }
      logger.info(`[REQ BODY] ${req.method} ${req.url}:\n${bodyFormatted}`);
    }
    try {
      await handle(req, res);
    } catch (err) {
      logger.error(`JTL handler error: ${err.message}`);
      sendJson(res, 500, { Message: err.message });
    }
  };
}

module.exports = {
  createJtlPosServer,
  buildConfig,
};
