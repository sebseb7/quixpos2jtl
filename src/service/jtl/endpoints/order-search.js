const { sendJson } = require('../http');
const { searchOrders } = require('../queries/order-search');

const method = 'GET';
const path = '/v1/order';

async function handle(_req, res, { url }) {
  const search = (
    url.searchParams.get('search') ||
    url.searchParams.get('query') ||
    url.searchParams.get('q') ||
    url.searchParams.get('orderNumber') ||
    ''
  ).trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);

  const orders = await searchOrders({ search, limit });
  return sendJson(res, 200, orders);
}

module.exports = {
  method,
  path,
  handle,
};
