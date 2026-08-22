const sql = require('mssql');
const { getPool } = require('../../db');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const PRODUCT_COUNT_SQL = `
${CATEGORY_TREE_CTE}
SELECT COUNT(DISTINCT a.kArtikel) AS ProductCount
FROM dbo.tArtikel a
INNER JOIN dbo.tKategorieArtikel ka ON ka.kArtikel = a.kArtikel
WHERE a.cAktiv = 'Y'
  AND ka.kKategorie IN (SELECT kKategorie FROM CategoryTree)
  AND (@kShop = 0 OR EXISTS (SELECT 1 FROM dbo.tKategorieShop ks WHERE ks.kKategorie = ka.kKategorie AND ks.kShop = @kShop))
  AND (
    CONVERT(BIGINT, a.bRowversion) > @cursor
    OR EXISTS (
      SELECT 1 FROM dbo.tArtikelbildPlattform abp
      WHERE abp.kArtikel = a.kArtikel
        AND abp.kShop = @kShop
        AND CONVERT(BIGINT, abp.bRowversion) > @cursor
    )
  );
`;

async function getProductCount({ cursor = 0, rootCategoryId = getRootCategoryId() } = {}) {
  const result = await categoryTreeRequest(getPool(), rootCategoryId)
    .input('cursor', sql.BigInt, cursor)
    .query(PRODUCT_COUNT_SQL);
  return result.recordset[0]?.ProductCount ?? 0;
}

module.exports = { getProductCount };
