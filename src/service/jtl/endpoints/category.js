const { sendJson, serverTimestamp } = require('../http');
const { getCategoryList } = require('../queries/category-list');

const method = 'GET';
const path = '/v1/category';

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedCategory')) || 0;
  const limit = Number(url.searchParams.get('limit')) || 20;

  const categories = await getCategoryList({ cursor, limit });
  const timestamp = serverTimestamp();

  return sendJson(
    res,
    200,
    categories.map((category) => ({
      ...category,
      updated_at: timestamp,
      created_at: timestamp,
    }))
  );
}

module.exports = {
  method,
  path,
  handle,
};
