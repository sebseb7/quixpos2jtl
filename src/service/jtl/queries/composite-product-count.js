const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopId } = require('../shop');

const COMPOSITE_PRODUCT_COUNT_SQL = `
SELECT COUNT(DISTINCT a.kArtikel) AS CompositeProductCount
FROM dbo.tArtikel a
INNER JOIN dbo.tStueckliste s ON s.kStueckliste = a.kStueckliste
WHERE a.kStueckliste <> 0
  AND (@kShop = 0 OR EXISTS (
    SELECT 1 FROM dbo.tKategorieArtikel ka
    INNER JOIN dbo.tKategorieShop ks ON ks.kKategorie = ka.kKategorie AND ks.kShop = @kShop
    WHERE ka.kArtikel = a.kArtikel
  ))
  AND CONVERT(BIGINT, a.bRowversion) > @cursor;
`;

async function getCompositeProductCount({ cursor = 0 } = {}) {
  const result = await getPool()
    .request()
    .input('cursor', sql.BigInt, cursor)
    .input('kShop', sql.Int, getActiveShopId())
    .query(COMPOSITE_PRODUCT_COUNT_SQL);
  return result.recordset[0]?.CompositeProductCount ?? 0;
}

module.exports = { getCompositeProductCount };
