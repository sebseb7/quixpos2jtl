const sql = require('mssql');
const { getPool } = require('../../db');

const CUSTOMER_GROUP_IDS_SQL = `
SELECT kKundenGruppe
FROM dbo.tKundenGruppe
ORDER BY kKundenGruppe;
`;

const CUSTOMER_GROUP_LIST_SQL = `
SELECT
  kKundenGruppe AS id,
  cName AS name,
  nStandard AS standard,
  fRabatt AS discountPercent,
  CONVERT(BIGINT, bRowversion) AS lastChanged
FROM dbo.tKundenGruppe
WHERE CONVERT(BIGINT, bRowversion) > @cursor
ORDER BY lastChanged ASC;
`;

const CUSTOMER_GROUP_COUNT_SQL = `
SELECT COUNT(*) AS CustomerGroupCount
FROM dbo.tKundenGruppe
WHERE CONVERT(BIGINT, bRowversion) > @cursor;
`;

async function getCustomerGroupIds() {
  const result = await getPool().request().query(CUSTOMER_GROUP_IDS_SQL);
  return result.recordset.map((row) => row.kKundenGruppe);
}

async function getCustomerGroupList({ cursor = 0 } = {}) {
  const result = await getPool().request().input('cursor', sql.BigInt, cursor).query(CUSTOMER_GROUP_LIST_SQL);

  return result.recordset.map((row) => ({
    customerGroupId: String(row.id),
    name: row.name,
    standard: String(row.standard),
    discountPercent: Number(row.discountPercent).toFixed(2),
    lastChanged: String(row.lastChanged),
  }));
}

async function getCustomerGroupCount({ cursor = 0 } = {}) {
  const result = await getPool().request().input('cursor', sql.BigInt, cursor).query(CUSTOMER_GROUP_COUNT_SQL);
  return result.recordset[0]?.CustomerGroupCount ?? 0;
}

module.exports = {
  getCustomerGroupIds,
  getCustomerGroupList,
  getCustomerGroupCount,
};
