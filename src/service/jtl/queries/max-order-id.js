const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopSubshopId } = require('../shop');

const MAX_ORDER_ID_SQL = `
SELECT ISNULL(MAX(kPosAuftrag), 0) AS MaxOrderId
FROM Pos.tAuftragMapping
WHERE kShopSubShop = @kShopSubShop;
`;

async function getMaxOrderIdCount() {
  const kShopSubShop = getActiveShopSubshopId();
  if (!kShopSubShop) {
    return 0;
  }

  const result = await getPool()
    .request()
    .input('kShopSubShop', sql.Int, kShopSubShop)
    .query(MAX_ORDER_ID_SQL);

  return result.recordset[0]?.MaxOrderId ?? 0;
}

module.exports = { getMaxOrderIdCount };
