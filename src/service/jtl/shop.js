let activeShopId = 0;
let activeShopSubshopId = 0;
let activeMaxLastChanged = 0;

function setActiveShop(id) {
  activeShopId = Number(id) || 0;
}

function getActiveShopId() {
  return activeShopId;
}

function setActiveShopSubshop(id) {
  activeShopSubshopId = Number(id) || 0;
}

function getActiveShopSubshopId() {
  return activeShopSubshopId;
}

function setActiveMaxLastChanged(value) {
  activeMaxLastChanged = Number(value) || 0;
}

function getActiveMaxLastChanged() {
  return activeMaxLastChanged;
}

async function fetchActiveShop(pool) {
  try {
    const result = await pool.request().query(`
      SELECT TOP 1 kShop, kShopSubshop, nMaxLastChanged
      FROM dbo.tShopSubshop
      WHERE nGesperrt = 0
      ORDER BY kShop
    `);
    const id = result.recordset[0]?.kShop ?? 0;
    setActiveShop(id);
    setActiveShopSubshop(result.recordset[0]?.kShopSubshop ?? 0);
    setActiveMaxLastChanged(result.recordset[0]?.nMaxLastChanged ?? 0);
    return id;
  } catch (err) {
    setActiveShop(0);
    return 0;
  }
}

module.exports = {
  setActiveShop,
  getActiveShopId,
  setActiveShopSubshop,
  getActiveShopSubshopId,
  setActiveMaxLastChanged,
  getActiveMaxLastChanged,
  fetchActiveShop,
};
