const sql = require('mssql');
const { getActiveShopId, getActiveRootCategoryId } = require('../shop');

const CATEGORY_TREE_CTE = `
WITH CategoryTree AS (
    SELECT kKategorie FROM dbo.tKategorie WHERE (@rootCategoryId = 0 AND kOberKategorie = 0) OR (@rootCategoryId <> 0 AND kKategorie = @rootCategoryId)
    UNION ALL
    SELECT t.kKategorie
    FROM dbo.tKategorie t
    INNER JOIN CategoryTree ct ON t.kOberKategorie = ct.kKategorie
)`;

function getRootCategoryId() {
  return getActiveRootCategoryId();
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
