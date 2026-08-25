const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopId } = require('../shop');

const CUSTOMER_COUNT_SQL = `
SELECT COUNT(*) AS CustomerCount
FROM Pos.vCustomer
WHERE vCustomer.kShop = @kShop
  AND CONVERT(BIGINT, vCustomer.bLastChanged) > @cursor;
`;

async function getCustomerCount({ cursor = 0 } = {}) {
  const result = await getPool()
    .request()
    .input('kShop', sql.Int, getActiveShopId())
    .input('cursor', sql.BigInt, cursor)
    .query(CUSTOMER_COUNT_SQL);

  return result.recordset[0]?.CustomerCount ?? 0;
}

module.exports = { getCustomerCount };
