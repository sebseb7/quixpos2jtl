const { sendJson } = require('../http');
const { getCustomerGroupList } = require('../queries/customer-groups');

const method = 'GET';
const path = '/v1/customergroup';

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedCustomerGroup')) || 0;

  const customerGroups = await getCustomerGroupList({ cursor });

  return sendJson(res, 200, customerGroups);
}

module.exports = {
  method,
  path,
  handle,
};
