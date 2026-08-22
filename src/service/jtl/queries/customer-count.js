const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopId, getActiveShopSubshopId } = require('../shop');

const CUSTOMER_COUNT_SQL = `
SELECT COUNT(DISTINCT k.kKunde) AS CustomerCount
FROM dbo.tkunde k
LEFT JOIN dbo.tInetKundeShop iks
       ON iks.kKunde = k.kKunde
      AND iks.kShop = @kShop
      AND iks.kSubShop = @SubShopId
WHERE (@kShop = 0 OR EXISTS (
        SELECT 1 FROM dbo.tInetKundeShop x
        WHERE x.kKunde = k.kKunde AND x.kShop = @kShop
      ))
  AND CONVERT(BIGINT, k.bRowversion) > @cursor;
`;

async function getCustomerCount({ cursor = 0 } = {}) {
  const result = await getPool()
    .request()
    .input('kShop', sql.Int, getActiveShopId())
    .input('SubShopId', sql.Int, getActiveShopSubshopId())
    .input('cursor', sql.BigInt, cursor)
    .query(CUSTOMER_COUNT_SQL);

  return result.recordset[0]?.CustomerCount ?? 0;
}

module.exports = { getCustomerCount };
