const { sendJson } = require('../http');
const { getCompositeProductList } = require('../queries/composite-product-list');

const method = 'GET';
const path = '/v1/productcomposite';

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedCompositeProduct')) || 0;
  const limit = Number(url.searchParams.get('limit')) || 100;

  const composites = await getCompositeProductList({ cursor, limit });

  return sendJson(res, 200, composites);
}

module.exports = {
  method,
  path,
  handle,
};
