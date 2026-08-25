const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveLanguageId } = require('../shop');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const CATEGORY_COUNT_SQL = `
${CATEGORY_TREE_CTE}
SELECT COUNT(*) AS CategoryCount
FROM dbo.tKategorie k
LEFT JOIN dbo.tKategorieSprache ks ON ks.kKategorie = k.kKategorie AND ks.kSprache = @languageId
LEFT JOIN dbo.tKategoriebildPlattform kbp ON kbp.kKategorie = k.kKategorie
CROSS APPLY (
  SELECT MAX(v) AS lastChanged
  FROM (VALUES
    (CONVERT(BIGINT, k.bRowversion)),
    (CONVERT(BIGINT, ks.bRowversion)),
    (CONVERT(BIGINT, kbp.bRowversion)),
    ((SELECT MAX(CONVERT(BIGINT, ka.bRowversion)) FROM dbo.tKategorieArtikel ka WHERE ka.kKategorie = k.kKategorie)),
    ((SELECT MAX(CONVERT(BIGINT, ksh.bRowversion)) FROM dbo.tKategorieShop ksh WHERE ksh.kKategorie = k.kKategorie AND (@kShop = 0 OR ksh.kShop = @kShop)))
  ) AS t(v)
) rv
WHERE k.kKategorie IN (SELECT kKategorie FROM CategoryTree WHERE (@rootCategoryId = 0 OR kKategorie <> @rootCategoryId))
  AND k.cAktiv = 'Y'
  AND (@kShop = 0 OR EXISTS (SELECT 1 FROM dbo.tKategorieShop ks2 WHERE ks2.kKategorie = k.kKategorie AND ks2.kShop = @kShop))
  AND rv.lastChanged > @cursor;
`;

async function getCategoryCount({ cursor = 0, rootCategoryId = getRootCategoryId() } = {}) {
  const languageId = getActiveLanguageId();

  const result = await categoryTreeRequest(getPool(), rootCategoryId)
    .input('cursor', sql.BigInt, cursor)
    .input('languageId', sql.Int, languageId)
    .query(CATEGORY_COUNT_SQL);
  return result.recordset[0]?.CategoryCount ?? 0;
}

module.exports = { getCategoryCount };
