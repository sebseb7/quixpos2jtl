const sql = require('mssql');
const { getPool } = require('../../db');
const { loadConfig } = require('../../../config');
const { CATEGORY_TREE_CTE, categoryTreeRequest, getRootCategoryId } = require('./category-tree');

const PRODUCT_COUNT_SQL = `
${CATEGORY_TREE_CTE}
SELECT COUNT(DISTINCT a.kArtikel) AS ProductCount
FROM dbo.tArtikel a
INNER JOIN dbo.tKategorieArtikel ka ON ka.kArtikel = a.kArtikel
LEFT JOIN dbo.tlagerbestand lb ON lb.kArtikel = a.kArtikel
LEFT JOIN dbo.tArtikelBeschreibung ab ON ab.kArtikel = a.kArtikel AND ab.kSprache = @languageId
CROSS APPLY (
  SELECT MAX(v) AS lastChanged
  FROM (VALUES
    (CONVERT(BIGINT, a.bRowversion)),
    (CONVERT(BIGINT, lb.bRowversion)),
    (CONVERT(BIGINT, ab.bRowversion)),
    ((SELECT MAX(CONVERT(BIGINT, abp.bRowversion)) FROM dbo.tArtikelbildPlattform abp WHERE abp.kArtikel = a.kArtikel AND (@kShop = 0 OR abp.kShop = @kShop))),
    ((SELECT MAX(CONVERT(BIGINT, p.bRowversion)) FROM dbo.tPreis p WHERE p.kArtikel = a.kArtikel AND (@kShop = 0 OR p.kShop = @kShop))),
    ((SELECT MAX(CONVERT(BIGINT, sp.bRowversion)) FROM dbo.tArtikelSonderpreis sp WHERE sp.kArtikel = a.kArtikel))
  ) AS t(v)
) rv
WHERE a.cAktiv = 'Y'
  AND ka.kKategorie IN (SELECT kKategorie FROM CategoryTree)
  AND (@kShop = 0 OR EXISTS (SELECT 1 FROM dbo.tKategorieShop ks WHERE ks.kKategorie = ka.kKategorie AND ks.kShop = @kShop))
  AND rv.lastChanged > @cursor;
`;

async function getProductCount({ cursor = 0, rootCategoryId = getRootCategoryId() } = {}) {
  const cfg = loadConfig();
  const languageId = Number(cfg.shop?.spracheId || cfg.shop?.sprache || process.env.LANGUAGE_ID) || 1;

  const result = await categoryTreeRequest(getPool(), rootCategoryId)
    .input('cursor', sql.BigInt, cursor)
    .input('languageId', sql.Int, languageId)
    .query(PRODUCT_COUNT_SQL);
  return result.recordset[0]?.ProductCount ?? 0;
}

module.exports = { getProductCount };
