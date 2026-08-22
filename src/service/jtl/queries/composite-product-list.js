const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopId } = require('../shop');

const COMPOSITE_PRODUCT_LIST_SQL = `
SELECT TOP (@limit)
  s.kVaterArtikel AS productId,
  s.kArtikel AS productIdComponent,
  CONVERT(VARCHAR(20), s.fAnzahl, 2) AS quantity,
  CONVERT(BIGINT, a.bRowversion) AS lastChanged
FROM dbo.tStueckliste s
INNER JOIN dbo.tArtikel a ON a.kArtikel = s.kVaterArtikel
WHERE a.kStueckliste <> 0
  AND (@kShop = 0 OR EXISTS (
    SELECT 1 FROM dbo.tKategorieArtikel ka
    INNER JOIN dbo.tKategorieShop ks ON ks.kKategorie = ka.kKategorie AND ks.kShop = @kShop
    WHERE ka.kArtikel = a.kArtikel
  ))
  AND CONVERT(BIGINT, a.bRowversion) > @cursor
ORDER BY lastChanged ASC;
`;

async function getCompositeProductList({ cursor = 0, limit = 100 } = {}) {
  const result = await getPool()
    .request()
    .input('cursor', sql.BigInt, cursor)
    .input('limit', sql.Int, limit)
    .input('kShop', sql.Int, getActiveShopId())
    .query(COMPOSITE_PRODUCT_LIST_SQL);

  return result.recordset.map((row) => ({
    productId: String(row.productId),
    productIdComponent: String(row.productIdComponent),
    quantity: row.quantity,
    lastChanged: String(row.lastChanged),
  }));
}

module.exports = { getCompositeProductList };
