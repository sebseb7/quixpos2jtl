const sql = require('mssql');
const { getPool } = require('../../db');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const CATEGORY_COUNT_SQL = `
${CATEGORY_TREE_CTE}
SELECT COUNT(*) AS CategoryCount
FROM dbo.tKategorie k
WHERE k.kKategorie IN (SELECT kKategorie FROM CategoryTree)
  AND (@kShop = 0 OR EXISTS (SELECT 1 FROM dbo.tKategorieShop ks WHERE ks.kKategorie = k.kKategorie AND ks.kShop = @kShop))
  AND CONVERT(BIGINT, k.bRowversion) > @cursor;
`;

async function getCategoryCount({ cursor = 0, rootCategoryId = getRootCategoryId() } = {}) {
  const result = await categoryTreeRequest(getPool(), rootCategoryId)
    .input('cursor', sql.BigInt, cursor)
    .query(CATEGORY_COUNT_SQL);
  return result.recordset[0]?.CategoryCount ?? 0;
}

module.exports = { getCategoryCount };
