const sql = require('mssql');
const { getPool } = require('../../db');
const { loadConfig } = require('../../../config');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const CATEGORY_LIST_SQL = `
${CATEGORY_TREE_CTE}
SELECT TOP (@limit)
  k.kKategorie AS id,
  k.kOberKategorie AS pid,
  k.nSort AS sort,
  ks.cName AS name,
  b.cHash AS imgHash,
  CONVERT(BIGINT, k.bRowversion) AS lastChanged
FROM dbo.tKategorie k
INNER JOIN dbo.tKategorieSprache ks ON ks.kKategorie = k.kKategorie AND ks.kSprache = @languageId
LEFT JOIN dbo.tKategoriebildPlattform kbp
  ON kbp.kKategorie = k.kKategorie
LEFT JOIN dbo.tBild b ON b.kBild = kbp.kBild
WHERE k.kKategorie IN (SELECT kKategorie FROM CategoryTree WHERE kKategorie <> @rootCategoryId)
  AND k.cAktiv = 'Y'
  AND (@kShop = 0 OR EXISTS (SELECT 1 FROM dbo.tKategorieShop ks2 WHERE ks2.kKategorie = k.kKategorie AND ks2.kShop = @kShop))
  AND CONVERT(BIGINT, k.bRowversion) > @cursor
ORDER BY lastChanged ASC;
`;

async function getCategoryList({ cursor = 0, limit = 20, rootCategoryId = getRootCategoryId() } = {}) {
  const cfg = loadConfig();
  const languageId = Number(cfg.shop?.sprache || process.env.LANGUAGE_ID) || 1;

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
