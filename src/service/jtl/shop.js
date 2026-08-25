const sql = require('mssql');
const { loadConfig } = require('../../config');

let activeShopId = null;
let activeShopSubshopId = null;
let activeMaxLastChanged = 0;
let activeShopDetails = null;

function setActiveShop(id) {
  activeShopId = id ? (Number(id) || null) : null;
}

function assertShopConfigured() {
  if (!activeShopId || !activeShopDetails) {
    throw new Error('JTL POS Shop is not configured. Please select a shop in settings.');
  }
}

function getActiveShopId() {
  assertShopConfigured();
  return activeShopId;
}

function setActiveShopSubshop(id) {
  activeShopSubshopId = id ? (Number(id) || null) : null;
}

function getActiveShopSubshopId() {
  assertShopConfigured();
  return activeShopSubshopId || 0;
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
  assertShopConfigured();
  return Number(activeShopDetails.kSprache) || 1;
}

function getActiveWarehouseId() {
  assertShopConfigured();
  return Number(activeShopDetails.kWarenlager) || 1;
}

function getActiveRootCategoryId() {
  assertShopConfigured();
  return Number(activeShopDetails.kKategorie ?? 0);
}

function getActiveTaxZoneId() {
  assertShopConfigured();
  return Number(activeShopDetails.kSteuerzone) || 0;
}

function getActiveTaxZoneName() {
  assertShopConfigured();
  return activeShopDetails.cSteuerzoneName || '';
}

function getActiveUserId() {
  const config = loadConfig();
  const uid = Number(config.shop?.kBenutzer);
  if (!uid || uid <= 0) {
    throw new Error('JTL-Wawi Benutzer is not configured. Please select a user in settings.');
  }
  return uid;
}

function getActiveBenutzerId() {
  return getActiveUserId();
}

async function fetchActiveShop(pool) {
  try {
    const config = loadConfig();
    const shopId = Number(config.shop?.kShop) || null;

    if (!shopId || shopId <= 0) {
      setActiveShop(null);
      setActiveShopSubshop(null);
      setActiveMaxLastChanged(0);
      setActiveShopDetails(null);
      return null;
    }

    setActiveShop(shopId);

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
    if (!details) {
      setActiveShop(null);
      setActiveShopSubshop(null);
      setActiveMaxLastChanged(0);
      setActiveShopDetails(null);
      return null;
    }

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

    return shopId;
  } catch (err) {
    setActiveShop(null);
    setActiveShopSubshop(null);
    setActiveMaxLastChanged(0);
    setActiveShopDetails(null);
    return null;
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
  getActiveUserId,
  getActiveBenutzerId,
  assertShopConfigured,
  fetchActiveShop,
};
