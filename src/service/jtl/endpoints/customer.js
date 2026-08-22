const { sendJson } = require('../http');
const { getCustomerList } = require('../queries/customer-list');

const method = 'GET';
const path = '/v1/customer';

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedCustomer')) || 0;
  const limit = Number(url.searchParams.get('limit')) || 20;

  const customers = await getCustomerList({ cursor, limit });

  return sendJson(res, 200, customers);
}

module.exports = {
  method,
  path,
  handle,
};
