const crypto = require('crypto');
const { sendJson, serverTimestamp } = require('../http');

const method = 'GET';
const path = '/v1/newpin';

function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}

function handle(_req, res, { pairingStore, config }) {
  if (config.newPinEnabled === false) {
    return sendJson(res, 403, {
      Message: 'This endpoint is disabled.',
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
