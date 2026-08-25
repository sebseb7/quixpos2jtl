const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveLanguageId } = require('../shop');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const CATEGORY_LIST_SQL = `
${CATEGORY_TREE_CTE}
SELECT TOP (@limit)
  k.kKategorie AS id,
  k.kOberKategorie AS pid,
  k.nSort AS sort,
  ks.cName AS name,
  b.cHash AS imgHash,
  rv.lastChanged
FROM dbo.tKategorie k
INNER JOIN dbo.tKategorieSprache ks ON ks.kKategorie = k.kKategorie AND ks.kSprache = @languageId
LEFT JOIN dbo.tKategoriebildPlattform kbp
  ON kbp.kKategorie = k.kKategorie
LEFT JOIN dbo.tBild b ON b.kBild = kbp.kBild
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
  AND rv.lastChanged > @cursor
ORDER BY rv.lastChanged ASC;
`;

async function getCategoryList({ cursor = 0, limit = 20, rootCategoryId = getRootCategoryId() } = {}) {
  const languageId = getActiveLanguageId();

  const result = await categoryTreeRequest(getPool(), rootCategoryId)
    .input('cursor', sql.BigInt, cursor)
    .input('limit', sql.Int, limit)
    .input('languageId', sql.Int, languageId)
    .query(CATEGORY_LIST_SQL);

  return result.recordset.map((row) => ({
    _id: String(row.id),
    imghash: row.imgHash ?? null,
    imgsrc: row.imgHash ?? null,
    name: row.name,
    pid: row.pid === rootCategoryId ? '0' : String(row.pid),
    discounts: [],
    sort: String(row.sort),
    lastChanged: String(row.lastChanged),
  }));
}

module.exports = { getCategoryList };
