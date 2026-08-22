const { sendJson } = require('../http');
const { getDeletedEntityList } = require('../queries/deleted-entity-list');

const method = 'GET';
const path = '/v1/deletedentity';

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedDeletedEntity')) || 0;
  const limit = Number(url.searchParams.get('limit')) || 600;

  const deletedEntities = await getDeletedEntityList({ cursor, limit });

  return sendJson(res, 200, deletedEntities);
}

module.exports = {
  method,
  path,
  handle,
};
