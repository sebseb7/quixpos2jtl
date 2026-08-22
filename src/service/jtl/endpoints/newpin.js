const crypto = require('crypto');
const { sendJson, serverTimestamp } = require('../http');

const method = 'GET';
const path = '/v1/newpin';

function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}

function handle(_req, res, { pairingStore, config }) {
  if (!config.newPinEnabled) {
    return sendJson(res, 403, {
      Message: 'This endpoint is disabled. Set NEWPIN_ENABLED=true to enable it.',
    });
  }

  const pin = generatePin();
  pairingStore.setPairingCode(pin, 'JTL-POS');

  return sendJson(res, 200, {
    pin,
    name: 'JTL-POS',
    serverTimestamp: serverTimestamp(),
  });
}

module.exports = {
  method,
  path,
  handle,
};
