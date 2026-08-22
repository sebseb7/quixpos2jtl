const sql = require('mssql');
const { getActiveShopId } = require('../shop');
const { loadConfig } = require('../../../config');

const CATEGORY_TREE_CTE = `
WITH CategoryTree AS (
    SELECT kKategorie FROM dbo.tKategorie WHERE kKategorie = @rootCategoryId
    UNION ALL
    SELECT t.kKategorie
    FROM dbo.tKategorie t
    INNER JOIN CategoryTree ct ON t.kOberKategorie = ct.kKategorie
)`;

function getRootCategoryId() {
  const cfg = loadConfig();
  return Number(cfg.shop?.kategorie || process.env.ROOT_CATEGORY_ID) || 1;
}

function categoryTreeRequest(pool, rootCategoryId = getRootCategoryId()) {
  return pool
    .request()
    .input('rootCategoryId', sql.Int, rootCategoryId)
    .input('kShop', sql.Int, getActiveShopId());
}

module.exports = {
  CATEGORY_TREE_CTE,
  getRootCategoryId,
  categoryTreeRequest,
};
