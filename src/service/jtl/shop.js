const sql = require('mssql');
const { loadConfig } = require('../../config');

let activeShopId = 0;
let activeShopSubshopId = 0;
let activeMaxLastChanged = 0;
let activeShopDetails = null;

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

function setActiveShopDetails(details) {
  activeShopDetails = details ? { ...details } : null;
}

function getActiveShopDetails() {
  return activeShopDetails ? { ...activeShopDetails } : null;
}

function getActiveLanguageId() {
  return Number(activeShopDetails?.kSprache) || 1;
}

function getActiveWarehouseId() {
  return Number(activeShopDetails?.kWarenlager) || 1;
}

function getActiveRootCategoryId() {
  return Number(activeShopDetails?.kKategorie ?? 0);
}

function getActiveTaxZoneId() {
  return Number(activeShopDetails?.kSteuerzone) || 0;
}

function getActiveTaxZoneName() {
  return activeShopDetails?.cSteuerzoneName || '';
}

async function fetchActiveShop(pool) {
  try {
    const config = loadConfig();
    let shopId = Number(config.shop?.kShop || config.shop?.shopId || 0);

    // If no shop configured, auto-select first active POS shop (nTyp = 4, nAktiv = 1, nGesperrt = 0)
    if (!shopId) {
      const posRes = await pool.request().query(`
        SELECT TOP 1 kShop
        FROM dbo.tShop
        WHERE nTyp = 4 AND nAktiv = 1 AND nGesperrt = 0
        ORDER BY kShop
      `);
      shopId = posRes.recordset[0]?.kShop ?? 0;
    }

    // Fallback to tShopSubshop if still 0
    if (!shopId) {
      const subRes = await pool.request().query(`
        SELECT TOP 1 kShop
        FROM dbo.tShopSubshop
        WHERE nGesperrt = 0
        ORDER BY kShop
      `);
      shopId = subRes.recordset[0]?.kShop ?? 0;
    }

    setActiveShop(shopId);

    if (shopId > 0) {
      const detailsRes = await pool.request()
        .input('kShop', sql.Int, shopId)
        .query(`
          SELECT TOP 1
            s.kShop,
            s.cName,
            s.nGesperrt,
            s.kFirma,
            s.kKategorie,
            s.nTyp,
            s.kWarenlager,
            s.nAktiv,
            s.kSprache,
            f.cName AS cFirmaName,
            f.cLandISO,
            tz.kSteuerzone,
            tz.cName AS cSteuerzoneName,
            wl.cName AS cWarenlagerName,
            sp.cNameEng AS cSpracheName,
            CASE
              WHEN s.kKategorie = 0 THEN 'Alle Kategorien (Root)'
              ELSE ISNULL(kat.cName, 'Kategorie ' + CAST(s.kKategorie AS varchar(20)))
            END AS cKategorieName
          FROM dbo.tShop s
          LEFT JOIN dbo.tFirma f ON f.kFirma = s.kFirma
          OUTER APPLY (
            SELECT TOP 1 sz.kSteuerzone, sz.cName
            FROM dbo.tSteuerzone sz
            INNER JOIN dbo.tSteuerzoneLand szl ON szl.kSteuerzone = sz.kSteuerzone
            WHERE sz.kFirma = s.kFirma AND szl.cISO = f.cLandISO
            ORDER BY sz.kSteuerzone
          ) tz
          LEFT JOIN dbo.tWarenLager wl ON wl.kWarenLager = s.kWarenlager
          LEFT JOIN dbo.tSpracheUsed sp ON sp.kSprache = s.kSprache
          OUTER APPLY (
            SELECT TOP 1 ks.cName
            FROM dbo.tKategorieSprache ks
            WHERE ks.kKategorie = s.kKategorie
            ORDER BY CASE WHEN ks.kSprache = s.kSprache THEN 0 ELSE 1 END
          ) kat
          WHERE s.kShop = @kShop
        `);

      const details = detailsRes.recordset[0] || null;
      setActiveShopDetails(details);

      const subshopRes = await pool.request()
        .input('kShop', sql.Int, shopId)
        .query(`
          SELECT TOP 1 kShopSubshop, nMaxLastChanged
          FROM dbo.tShopSubshop
          WHERE kShop = @kShop AND nGesperrt = 0
          ORDER BY kShopSubshop
        `);

      const subshop = subshopRes.recordset[0];
      setActiveShopSubshop(subshop?.kShopSubshop ?? 0);
      setActiveMaxLastChanged(subshop?.nMaxLastChanged ?? 0);
    } else {
      setActiveShopDetails(null);
      setActiveShopSubshop(0);
      setActiveMaxLastChanged(0);
    }

    return shopId;
  } catch (err) {
    setActiveShop(0);
    setActiveShopSubshop(0);
    setActiveMaxLastChanged(0);
    setActiveShopDetails(null);
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
  setActiveShopDetails,
  getActiveShopDetails,
  getActiveLanguageId,
  getActiveWarehouseId,
  getActiveRootCategoryId,
  getActiveTaxZoneId,
  getActiveTaxZoneName,
  fetchActiveShop,
};
