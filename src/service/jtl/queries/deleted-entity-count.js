const sql = require('mssql');
const { getPool } = require('../../db');

const DELETED_ENTITY_COUNT_SQL = `
SELECT COUNT(*) AS DeletedEntityCount
FROM Pos.vDeletedEntity
WHERE CONVERT(BIGINT, vDeletedEntity.bLastChanged) > @cursor;
`;

async function getDeletedEntityCount({ cursor = 0 } = {}) {
  const result = await getPool()
    .request()
    .input('cursor', sql.BigInt, cursor)
    .query(DELETED_ENTITY_COUNT_SQL);
  return result.recordset[0]?.DeletedEntityCount ?? 0;
}

module.exports = { getDeletedEntityCount };
