const { sendJson } = require('../http');
const { logger } = require('../../logger');
const { createOrder } = require('../queries/create-order');

const method = 'POST';
const path = '/v1/order';

function parseBody(buffer) {
  if (!buffer || !buffer.length) {
    return null;
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

function getOrders(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }
  if (Array.isArray(body.orders)) {
    return body.orders;
  }
  return [];
}

async function handle(req, res) {
  const body = parseBody(req.rawBody);

  if (body === undefined) {
    return sendJson(res, 500, []);
  }

  const orders = getOrders(body);
  const results = [];

  for (const order of orders) {
    logger.logOrder(order);
    const externalOrderId = String(order?.externalId ?? '');

    try {
      const created = await createOrder(order);
      if (created.alreadyExists) {
        const msg = `order already mapped, skipped save (kAuftrag=${created.orderId}, ${created.orderNumber})`;
        logger.error(`order externalId=${externalOrderId} skipped: ${msg}`);
        results.push({
          status: 'ERROR',
          externalOrderId,
          message: msg,
        });
      } else {
        logger.success(`order ${created.orderNumber} (kAuftrag=${created.orderId}) created for externalId=${externalOrderId}`);
        results.push({
          status: 'OK',
          externalOrderId,
          message: '',
        });
      }
    } catch (err) {
      logger.error(`order externalId=${externalOrderId} failed: ${err.message}`);
      results.push({
        status: 'ERROR',
        externalOrderId,
        message: err.message,
      });
    }
  }

  const failed = results.filter((r) => r.status === 'ERROR').length;
  const httpStatus = failed > 0 ? 500 : 200;
  return sendJson(res, httpStatus, results);
}

module.exports = {
  method,
  path,
  handle,
};
