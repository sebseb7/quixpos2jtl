const crypto = require('crypto');
const { sendJson, serverTimestamp } = require('../http');

const method = 'GET';
const path = '/v1/client';

function buildClientStep1(config) {
  const {
    certificateFingerprint,
    certificateSerialNumber,
    mandantId,
    serverFingerprint,
  } = config;

  return {
    authCode: null,
    authToken: null,
    certificateFingerprint,
    certificateSerialNumber,
    mandantId,
    mandantName: null,
    mandantDatabase: null,
    serverFingerprint,
    name: null,
    serverTimestamp: serverTimestamp(),
  };
}

function buildClientStep2(authCode, config) {
  const {
    authToken,
    certificateFingerprint,
    certificateSerialNumber,
    mandantId,
    mandantName,
    mandantDatabase,
  } = config;

  return {
    authCode,
    authToken,
    certificateFingerprint,
    certificateSerialNumber,
    mandantId,
    mandantName,
    mandantDatabase,
    serverFingerprint: null,
    name: null,
    serverTimestamp: serverTimestamp(),
  };
}

function handle(req, res, { url, pairingStore, config }) {
  const authCode = url.searchParams.get('authCode') || '';
  const name = url.searchParams.get('name') || 'JTL-POS';

  if (authCode.length <= 4 && authCode.length > 0) {
    return sendJson(res, 200, buildClientStep1(config));
  }

  if (authCode.length === 6) {
    if (pairingStore.hasPairingCode(authCode)) {
      const clientIp = req.socket?.remoteAddress || '';
      const deviceToken = config.authToken || crypto.randomBytes(16).toString('hex');
      pairingStore.registerDevice(deviceToken, name, { clientIp });
      pairingStore.revokePairingCode(authCode);
      return sendJson(res, 200, buildClientStep2(authCode, { ...config, authToken: deviceToken }));
    }
    return sendJson(res, 400, { Message: 'Der Authentifizierungscode ist falsch.' });
  }

  return sendJson(res, 400, { Message: 'Keinen passenden Authentifizierungscode gefunden.' });
}

module.exports = {
  method,
  path,
  handle,
};
