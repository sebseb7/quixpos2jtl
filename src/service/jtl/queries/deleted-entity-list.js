const sql = require('mssql');
const { getPool } = require('../../db');

const DELETED_ENTITY_LIST_SQL = `
SELECT TOP (@limit)
  vDeletedEntity.kEntityId,
  vDeletedEntity.nEntityType,
  CONVERT(BIGINT, vDeletedEntity.bLastChanged) AS lastChanged
FROM Pos.vDeletedEntity
WHERE CONVERT(BIGINT, vDeletedEntity.bLastChanged) > @cursor
ORDER BY lastChanged ASC;
`;

async function getDeletedEntityList({ cursor = 0, limit = 600 } = {}) {
  const result = await getPool()
    .request()
    .input('cursor', sql.BigInt, cursor)
    .input('limit', sql.Int, limit)
    .query(DELETED_ENTITY_LIST_SQL);

  return result.recordset.map((row) => ({
    entityId: String(row.kEntityId),
    entityType: String(row.nEntityType),
    lastChanged: String(row.lastChanged),
  }));
}

module.exports = { getDeletedEntityList };
