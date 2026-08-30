const sql = require('mssql');
const { getPool } = require('../../db');
const {
  getActiveShopId,
  getActiveShopSubshopId,
  getActiveLanguageId,
  getActiveUserId,
  getActiveFirmaId,
  assertShopConfigured,
} = require('../shop');
const { logger } = require('../../logger');
const { deliverOrder } = require('./delivery/index');

const COUNTRY_NAMES = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
};

function toNumber(value, fallback = 0) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function parseOrderDate(creationDate) {
  if (creationDate) {
    const parsed = new Date(String(creationDate).replace(' ', 'T'));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function steuerklasseForVat(vat) {
  if (vat >= 15) return 1;
  if (vat > 0) return 2;
  return 1;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function formatNumberPlaceholders(template, date) {
  if (!template) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  return template
    .replace(/<J>/g, String(date.getFullYear()))
    .replace(/<M>/g, pad2(date.getMonth() + 1))
    .replace(/<T>/g, pad2(date.getDate()))
    .replace(/<K>/g, pad2(isoWeek(date)));
}

async function nextNumberFromSequence(transaction, kLaufendeNummer, date) {
  const result = await new sql.Request(transaction).input('kLaufendeNummer', sql.Int, kLaufendeNummer).query(`
    DECLARE @n INT, @cPrefix NVARCHAR(50), @cSuffix NVARCHAR(50);
    UPDATE dbo.tLaufendeNummern
      SET @n = nNummer = nNummer + 1, @cPrefix = cPrefix, @cSuffix = cSuffix
      WHERE kLaufendeNummer = @kLaufendeNummer;
    SELECT @n AS nNummer, @cPrefix AS cPrefix, @cSuffix AS cSuffix;
  `);
  const row = result.recordset[0];
  if (!row || row.nNummer == null) {
    throw new Error(`dbo.tLaufendeNummern has no row ${kLaufendeNummer}`);
  }
  const prefix = formatNumberPlaceholders(row.cPrefix, date);
  const suffix = formatNumberPlaceholders(row.cSuffix, date);
  return `${prefix}${row.nNummer}${suffix}`;
}

const ORDER_NUMBER_SEQUENCE = 3;
const CUSTOMER_NUMBER_SEQUENCE = 6;

async function nextOrderNumber(transaction, orderDate) {
  return nextNumberFromSequence(transaction, ORDER_NUMBER_SEQUENCE, orderDate);
}

async function nextCustomerNumber(transaction) {
  return nextNumberFromSequence(transaction, CUSTOMER_NUMBER_SEQUENCE, new Date());
}

async function allocatePk(transaction, tableName) {
  const result = await new sql.Request(transaction).input('cName', sql.NVarChar, tableName).query(`
    DECLARE @pk INT;
    UPDATE dbo.tpk SET @pk = nummer, nummer = nummer + 1, dChanged = GETDATE() WHERE cName = @cName;
    SELECT @pk AS pk;
  `);
  const pk = result.recordset[0]?.pk;
  if (pk == null) {
    throw new Error(`dbo.tpk has no row for table '${tableName}'`);
  }
  return pk;
}

const VERSANDPOSITION_TYPE = 2;
const ZAHLUNG_TYPE_ZAHLUNG = 10;
const NIST_READONLY_NICHT_AENDERBAR = 2;
const NIST_EXTERNE_RECHNUNG_KEINE = 2;

function parseImportSetting(order) {
  return toNumber(order.settings?.importSetting, 0);
}

function parseInvoiceSetting(order) {
  return toNumber(order.settings?.invoiceSetting, 0);
}

function resolveNIstReadOnly(order) {
  return parseImportSetting(order) === 0 ? NIST_READONLY_NICHT_AENDERBAR : 0;
}

function resolveNIstExterneRechnung(order) {
  const importSetting = parseImportSetting(order);
  const invoiceSetting = parseInvoiceSetting(order);
  if (importSetting >= 2 && importSetting <= 5) return 0;
  if (invoiceSetting & 1) return 0;
  if (importSetting === 0) return NIST_EXTERNE_RECHNUNG_KEINE;
  return 0;
}

function isVersandposition(item) {
  return toNumber(item.type, 0) === VERSANDPOSITION_TYPE;
}

async function resolveVersandArt(transaction, shippingName) {
  const name = String(shippingName ?? '').trim();
  if (!name) {
    throw new Error('No shipping method (shippingName) specified in order request');
  }
  const result = await new sql.Request(transaction)
    .input('cName', sql.NVarChar, name)
    .query(`
      SELECT TOP 1 v.kVersandArt, v.cName, v.fPrice, v.fMwSt
      FROM dbo.tVersandArt v
      LEFT JOIN dbo.tVersandArtSprache vs ON vs.kVersandArt = v.kVersandArt
      WHERE v.cName = @cName OR vs.cName = @cName
    `);
  const versandArt = result.recordset[0] ?? null;
  if (!versandArt?.kVersandArt) {
    throw new Error(`Shipping method '${name}' not found in dbo.tVersandArt`);
  }
  return versandArt;
}

async function resolveZahlungsart(transaction, name, cache) {
  const lookupName = String(name || '').trim();
  if (!lookupName) {
    throw new Error('No payment method specified in order request');
  }
  const cacheKey = lookupName.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let row = null;
  const exact = await new sql.Request(transaction)
    .input('cName', sql.NVarChar, lookupName)
    .query('SELECT TOP 1 kZahlungsart, cName FROM dbo.tZahlungsart WHERE cName = @cName');
  row = exact.recordset[0] ?? null;

  if (!row) {
    const lang = await new sql.Request(transaction)
      .input('cName', sql.NVarChar, lookupName)
      .query(`
        SELECT TOP 1 z.kZahlungsart, z.cName
        FROM dbo.tZahlungsArtSprache zs
        INNER JOIN dbo.tZahlungsart z ON z.kZahlungsart = zs.kZahlungsart
        WHERE zs.cName = @cName
      `);
    row = lang.recordset[0] ?? null;
  }

  if (!row) {
    const ci = await new sql.Request(transaction)
      .input('cName', sql.NVarChar, lookupName)
      .query('SELECT TOP 1 kZahlungsart, cName FROM dbo.tZahlungsart WHERE UPPER(cName) = UPPER(@cName)');
    row = ci.recordset[0] ?? null;
  }

  if (!row) {
    throw new Error(`Payment method '${lookupName}' not found in dbo.tZahlungsart`);
  }

  const zahlungsart = { kZahlungsart: row.kZahlungsart, cName: row.cName };
  cache.set(cacheKey, zahlungsart);
  return zahlungsart;
}

async function resolveFirmaHistory(transaction, kFirma) {
  const result = await new sql.Request(transaction)
    .input('kFirma', sql.Int, kFirma)
    .query(`
      SELECT TOP 1 kFirmaHistory
      FROM dbo.tFirmaHistory
      WHERE kFirma = @kFirma
      ORDER BY kFirmaHistory DESC
    `);
  const kFirmaHistory = result.recordset[0]?.kFirmaHistory;
  if (!kFirmaHistory) {
    throw new Error(`No FirmaHistory found in dbo.tFirmaHistory for Firma ${kFirma}`);
  }
  return kFirmaHistory;
}

async function resolvePlattform(transaction) {
  const result = await new sql.Request(transaction).query(`
    SELECT TOP 1 nPlattform
    FROM dbo.tPlattform
    WHERE cName = 'JTL-POS' OR nPlattform = 7
    ORDER BY CASE WHEN cName = 'JTL-POS' THEN 0 ELSE 1 END
  `);
  const nPlattform = result.recordset[0]?.nPlattform;
  if (nPlattform == null) {
    throw new Error('JTL-POS platform not found in dbo.tPlattform');
  }
  return nPlattform;
}

async function resolveDefaultKundengruppe(transaction) {
  const result = await new sql.Request(transaction).query(`
    SELECT TOP 1 kKundenGruppe
    FROM dbo.tKundenGruppe
    WHERE nStandard = 1
    ORDER BY kKundenGruppe
  `);
  const kKundenGruppe = result.recordset[0]?.kKundenGruppe;
  if (!kKundenGruppe) {
    throw new Error('No standard customer group (nStandard = 1) found in dbo.tKundenGruppe');
  }
  return kKundenGruppe;
}

async function createCustomer(transaction, { customerNumber, address, defaultKundengruppe, kFirma }) {
  const a = address || {};
  const iso = (a.countryIso || 'DE').toUpperCase();
  const kKundengruppe = Number(a.customerGroupId) || defaultKundengruppe;
  const kSprache = getActiveLanguageId();

  const result = await new sql.Request(transaction)
    .input('cKundenNr', sql.NVarChar, customerNumber)
    .input('cFirma', sql.NVarChar, a.company || '')
    .input('cAnrede', sql.NVarChar, a.salutation || '')
    .input('cTitel', sql.NVarChar, a.title || '')
    .input('cVorname', sql.NVarChar, a.firstName || '')
    .input('cName', sql.NVarChar, a.lastName || 'Laufkunde')
    .input('cStrasse', sql.NVarChar, a.street || '-')
    .input('cPLZ', sql.NVarChar, a.zipCode || '')
    .input('cOrt', sql.NVarChar, a.city || '-')
    .input('cLand', sql.NVarChar, COUNTRY_NAMES[iso] || iso)
    .input('cTel', sql.NVarChar, a.phone || '')
    .input('cFax', sql.NVarChar, a.fax || '')
    .input('cEMail', sql.NVarChar, a.email || '')
    .input('cMobil', sql.NVarChar, a.mobile || '')
    .input('fRabatt', sql.Decimal(18, 13), toNumber(a.discount, 0))
    .input('cAdressZusatz', sql.NVarChar, a.addressAddition || '')
    .input('cGeburtstag', sql.NVarChar, a.birthday || '')
    .input('kKundenGruppe', sql.Int, kKundengruppe)
    .input('kSprache', sql.Int, kSprache)
    .input('cISO', sql.NVarChar, iso)
    .input('cBundesland', sql.NVarChar, a.state || '')
    .input('cHerkunft', sql.NVarChar, 'Kasse')
    .input('cKassenKunde', sql.Char(1), 'Y')
    .input('nDebitorennr', sql.Int, Number(a.debtorNumber) || 0)
    .input('kFirma', sql.Int, kFirma)
    .query(`
      DECLARE @returnValue INT;
      DECLARE @kunde_daten dbo.TYPE_spkundeInsert;
      INSERT INTO @kunde_daten
        (kInetKunde, kKundenKategorie, cKundenNr, cFirma, cAnrede, cTitel, cVorname, cName,
         cStrasse, cPLZ, cOrt, cLand, cTel, cFax, cEMail, dErstellt, cMobil, fRabatt, cUSTID, cNewsletter,
         cZusatz, cEbayName, kBuyer, cAdressZusatz, cGeburtstag, cWWW, cSperre, cPostID, kKundenGruppe,
         nZahlungsziel, kSprache, cISO, cBundesland, cHerkunft, cKassenKunde, cHRNr, kZahlungsart,
         nDebitorennr, cSteuerNr, nKreditlimit, kKundenDrucktext, nMahnstopp, nMahnrhythmus, kFirma,
         fProvision, nVertreter, fSkonto, nSkontoInTagen)
      VALUES
        (0, 0, @cKundenNr, @cFirma, @cAnrede, @cTitel, @cVorname, @cName,
         @cStrasse, @cPLZ, @cOrt, @cLand, @cTel, @cFax, @cEMail, GETDATE(), @cMobil, @fRabatt, NULL, 'N',
         N'', N'', 0, @cAdressZusatz, @cGeburtstag, N'', 'N', NULL, @kKundenGruppe,
         0, @kSprache, @cISO, @cBundesland, @cHerkunft, @cKassenKunde, N'', 0,
         @nDebitorennr, N'', 0, 0, 0, 0, @kFirma,
         NULL, 0, 0, 0);
      EXEC @returnValue = Kunde.spKundeInsert @daten = @kunde_daten;
      SELECT @returnValue AS kKunde;
    `);

  const kKunde = result.recordset[0]?.kKunde;
  if (!kKunde || kKunde <= 0) {
    throw new Error(`Kunde.spKundeInsert failed for '${customerNumber}'`);
  }
  return { kKunde, kKundengruppe };
}

function isWalkInOrder(order) {
  const customerNumber = String(order.customerNumber || '').trim();
  if (!customerNumber || customerNumber === '0') return true;

  const billing = order.billingAddress || {};
  return (billing.lastName || '') === 'Laufkunde' && !(billing.firstName || '').trim();
}

function resolveAuftragCKundenNr(order) {
  return isWalkInOrder(order) ? '0' : String(order.customerNumber || '');
}

async function lookupKassenkunde(transaction, defaultKundengruppe) {
  const result = await new sql.Request(transaction).query(
    "SELECT TOP 1 kKunde, kKundenGruppe FROM dbo.tKunde WHERE cKassenKunde = 'Y' ORDER BY kKunde"
  );
  if (result.recordset[0]) {
    return {
      kKunde: result.recordset[0].kKunde,
      kKundengruppe: result.recordset[0].kKundenGruppe || defaultKundengruppe,
    };
  }
  return null;
}

async function resolveCustomer(transaction, order, kFirma, defaultKundengruppe) {
  if (isWalkInOrder(order)) {
    const kassenKunde = await lookupKassenkunde(transaction, defaultKundengruppe);
    if (kassenKunde) return kassenKunde;
    return createCustomer(transaction, {
      customerNumber: await nextCustomerNumber(transaction),
      address: order.billingAddress,
      defaultKundengruppe,
      kFirma,
    });
  }

  const customerNumber = String(order.customerNumber || '').trim();
  const result = await new sql.Request(transaction)
    .input('cKundenNr', sql.NVarChar, customerNumber)
    .query('SELECT TOP 1 kKunde, kKundenGruppe FROM dbo.tKunde WHERE cKundenNr = @cKundenNr');
  if (result.recordset[0]) {
    return {
      kKunde: result.recordset[0].kKunde,
      kKundengruppe: result.recordset[0].kKundenGruppe || defaultKundengruppe,
    };
  }
  return createCustomer(transaction, {
    customerNumber,
    address: order.billingAddress,
    defaultKundengruppe,
    kFirma,
  });
}

async function insertOrderAddress(transaction, kAuftrag, kKunde, address, nTyp) {
  const a = address || {};
  const iso = (a.countryIso || 'DE').toUpperCase();
  await new sql.Request(transaction)
    .input('kAuftrag', sql.Int, kAuftrag)
    .input('kKunde', sql.Int, kKunde)
    .input('cFirma', sql.NVarChar, a.company || '')
    .input('cAnrede', sql.NVarChar, a.salutation || '')
    .input('cTitel', sql.NVarChar, a.title || '')
    .input('cVorname', sql.NVarChar, a.firstName || '')
    .input('cName', sql.NVarChar, a.lastName || '-')
    .input('cStrasse', sql.NVarChar, a.street || '-')
    .input('cPLZ', sql.NVarChar, a.zipCode || '')
    .input('cOrt', sql.NVarChar, a.city || '-')
    .input('cLand', sql.NVarChar, COUNTRY_NAMES[iso] || iso)
    .input('cTel', sql.NVarChar, a.phone || '')
    .input('cZusatz', sql.NVarChar, a.extraAddressLine || '')
    .input('cAdressZusatz', sql.NVarChar, a.addressAddition || '')
    .input('cMobil', sql.NVarChar, a.mobile || '')
    .input('cMail', sql.NVarChar, a.email || '')
    .input('cFax', sql.NVarChar, a.fax || '')
    .input('cBundesland', sql.NVarChar, a.state || '')
    .input('cISO', sql.NVarChar, iso)
    .input('nTyp', sql.Int, nTyp)
    .query(`
      INSERT INTO Verkauf.tAuftragAdresse
        (kAuftrag, kKunde, cFirma, cAnrede, cTitel, cVorname, cName, cStrasse, cPLZ, cOrt, cLand,
         cTel, cZusatz, cAdressZusatz, cMobil, cMail, cFax, cBundesland, cISO, nTyp, nZolldokumenteErforderlich)
      VALUES (@kAuftrag, @kKunde, @cFirma, @cAnrede, @cTitel, @cVorname, @cName, @cStrasse, @cPLZ, @cOrt, @cLand,
         @cTel, @cZusatz, @cAdressZusatz, @cMobil, @cMail, @cFax, @cBundesland, @cISO, @nTyp, 0)
    `);
}

async function insertOrderText(transaction, kAuftrag, note) {
  const cAnmerkung = note != null ? String(note).trim() : '';
  if (!cAnmerkung) return;

  await new sql.Request(transaction)
    .input('kAuftrag', sql.Int, kAuftrag)
    .input('cAnmerkung', sql.NVarChar, cAnmerkung)
    .query(`
      IF EXISTS (SELECT 1 FROM Verkauf.tAuftragText WHERE kAuftrag = @kAuftrag)
      BEGIN
        UPDATE Verkauf.tAuftragText
        SET cAnmerkung = @cAnmerkung
        WHERE kAuftrag = @kAuftrag;
      END
      ELSE
      BEGIN
        INSERT INTO Verkauf.tAuftragText (kAuftrag, cAnmerkung)
        VALUES (@kAuftrag, @cAnmerkung);
      END
    `);
}

let hasGesamtColumnsCache = null;

async function checkHasGesamtColumns(transaction) {
  if (hasGesamtColumnsCache !== null) {
    return hasGesamtColumnsCache;
  }
  try {
    const result = await new sql.Request(transaction).query(`
      SELECT 1 AS hasCols
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'tAuftragPosition'
        AND COLUMN_NAME = 'fVkNettoGesamt'
    `);
    hasGesamtColumnsCache = result.recordset.length > 0;
  } catch {
    hasGesamtColumnsCache = false;
  }
  return hasGesamtColumnsCache;
}

async function insertOrderItem(transaction, kAuftrag, item) {
  const vat = toNumber(item.vat ?? item.taxRate ?? item.vatRate, 19);
  const quantity = toNumber(item.quantity ?? item.count ?? item.amount, 1);
  const rawPriceNet = item.priceNet ?? item.netPrice ?? item.unitNetPrice;
  const rawPriceGross = item.priceGross ?? item.grossPrice ?? item.price ?? item.unitPrice;
  const priceNet = rawPriceNet != null 
    ? toNumber(rawPriceNet, 0) 
    : (rawPriceGross != null ? toNumber(rawPriceGross, 0) / (1 + vat / 100) : 0);
  const discount = toNumber(item.discountPercent ?? item.discount ?? item.discountRate, 0);
  const kSteuerklasse = steuerklasseForVat(vat);
  const sku = String(item.sku || '').trim();
  const positionType = isVersandposition(item) ? VERSANDPOSITION_TYPE : toNumber(item.type, 0);

  let kArtikel = null;
  if (sku && positionType !== VERSANDPOSITION_TYPE) {
    const result = await new sql.Request(transaction)
      .input('cArtNr', sql.NVarChar, sku)
      .query('SELECT TOP 1 kArtikel, nIstVater FROM dbo.tArtikel WHERE cArtNr = @cArtNr');
    const row = result.recordset[0];
    kArtikel = row?.kArtikel ?? null;
    if (row?.nIstVater === 1) {
      kArtikel = null;
    }
  }

  const nType = positionType === VERSANDPOSITION_TYPE ? VERSANDPOSITION_TYPE : (kArtikel ? 1 : 0);
  const nReserviert = nType === VERSANDPOSITION_TYPE ? 0 : 1;

  const priceGross = rawPriceGross != null ? toNumber(rawPriceGross, priceNet * (1 + vat / 100)) : priceNet * (1 + vat / 100);
  const vkNettoGesamt = priceNet * quantity * (1 - discount / 100);
  const vkBruttoGesamt = priceGross * quantity * (1 - discount / 100);

  const hasGesamtColumns = await checkHasGesamtColumns(transaction);

  let req = new sql.Request(transaction)
    .input('kArtikel', sql.Int, kArtikel)
    .input('kAuftrag', sql.Int, kAuftrag)
    .input('cArtNr', sql.NVarChar, kArtikel ? sku : null)
    .input('cName', sql.NVarChar, item.name || sku || 'Position')
    .input('cHinweis', sql.NVarChar, item.note || '')
    .input('fAnzahl', sql.Float, quantity)
    .input('fEkNetto', sql.Float, 0.0)
    .input('fVkNetto', sql.Float, priceNet)
    .input('fMwSt', sql.Float, vat)
    .input('kSteuerklasse', sql.Int, kSteuerklasse)
    .input('nType', sql.Int, nType)
    .input('nReserviert', sql.Int, nReserviert)
    .input('cEinheit', sql.NVarChar, item.unit || '')
    .input('fRabatt', sql.Float, discount);

  let insertCols = `kArtikel, kAuftrag, cArtNr, nReserviert, cName, cHinweis, fAnzahl, fEkNetto, fVkNetto, fMwSt,
         cNameStandard, kSteuerklasse, nType, cEinheit, fFaktor, kSteuerschluessel, fRabatt`;
  let insertVals = `@kArtikel, @kAuftrag, @cArtNr, @nReserviert, @cName, @cHinweis, @fAnzahl, @fEkNetto, @fVkNetto, @fMwSt,
         @cName, @kSteuerklasse, @nType, @cEinheit, 1.0, 3, @fRabatt`;

  if (hasGesamtColumns) {
    req = req
      .input('fVkNettoGesamt', sql.Float, vkNettoGesamt)
      .input('fVkBruttoGesamt', sql.Float, vkBruttoGesamt);
    insertCols = `kArtikel, kAuftrag, cArtNr, nReserviert, cName, cHinweis, fAnzahl, fEkNetto, fVkNetto, fVkNettoGesamt, fVkBruttoGesamt, fMwSt,
         cNameStandard, kSteuerklasse, nType, cEinheit, fFaktor, kSteuerschluessel, fRabatt`;
    insertVals = `@kArtikel, @kAuftrag, @cArtNr, @nReserviert, @cName, @cHinweis, @fAnzahl, @fEkNetto, @fVkNetto, @fVkNettoGesamt, @fVkBruttoGesamt, @fMwSt,
         @cName, @kSteuerklasse, @nType, @cEinheit, 1.0, 3, @fRabatt`;
  }

  const result = await req.query(`
    DECLARE @t TABLE ([kAuftragPosition] INT);
    INSERT INTO Verkauf.tAuftragPosition (${insertCols})
    OUTPUT inserted.kAuftragPosition INTO @t
    VALUES (${insertVals});
    SELECT kAuftragPosition FROM @t;
  `);
  return result.recordset[0]?.kAuftragPosition ?? null;
}

function externalOrderNumbersMatch(mapped, incoming) {
  if (!incoming) return true;
  return String(mapped || '').toLowerCase() === String(incoming).toLowerCase();
}

async function findExistingPosOrderMapping(kPosAuftrag, externalOrderNumber) {
  const kShopSubShop = getActiveShopSubshopId();
  if (!Number.isInteger(kPosAuftrag) || !kShopSubShop) {
    return null;
  }

  const result = await getPool()
    .request()
    .input('kPosAuftrag', sql.Int, kPosAuftrag)
    .input('kShopSubShop', sql.Int, kShopSubShop)
    .query(`
      SELECT TOP 1 m.kAuftrag, a.cAuftragsNr, ISNULL(a.cExterneAuftragsnummer, '') AS cExterneAuftragsnummer
      FROM Pos.tAuftragMapping m
      LEFT JOIN Verkauf.tAuftrag a ON a.kAuftrag = m.kAuftrag
      WHERE m.kPosAuftrag = @kPosAuftrag
        AND m.kShopSubShop = @kShopSubShop
        AND m.kAuftrag IS NOT NULL
      ORDER BY m.kAuftrag DESC
    `);

  const row = result.recordset[0];
  if (!row?.kAuftrag) {
    return null;
  }
  if (!externalOrderNumbersMatch(row.cExterneAuftragsnummer, externalOrderNumber)) {
    return null;
  }
  return row;
}

async function upsertPosOrderMapping(transaction, kAuftrag, kPosAuftrag) {
  const kShopSubShop = getActiveShopSubshopId();
  if (!Number.isInteger(kPosAuftrag) || !kShopSubShop) {
    return;
  }
  await new sql.Request(transaction)
    .input('kPosAuftrag', sql.Int, kPosAuftrag)
    .input('kShopSubShop', sql.Int, kShopSubShop)
    .query(`
      DELETE FROM Pos.tAuftragMapping
      WHERE kPosAuftrag = @kPosAuftrag
        AND kShopSubShop = @kShopSubShop
    `);
  await new sql.Request(transaction)
    .input('kAuftrag', sql.Int, kAuftrag)
    .input('kPosAuftrag', sql.Int, kPosAuftrag)
    .input('kShopSubShop', sql.Int, kShopSubShop)
    .query(`
      INSERT INTO Pos.tAuftragMapping (kAuftrag, kPosAuftrag, kShopSubShop)
      VALUES (@kAuftrag, @kPosAuftrag, @kShopSubShop)
    `);
}

async function insertPosOrderPositionMapping(transaction, kAuftragPosition, kPosAuftragPosition) {
  const kShopSubShop = getActiveShopSubshopId();
  if (!Number.isInteger(kAuftragPosition) || !Number.isInteger(kPosAuftragPosition) || !kShopSubShop) {
    return;
  }
  await new sql.Request(transaction)
    .input('kAuftragPosition', sql.Int, kAuftragPosition)
    .input('kPosAuftragPosition', sql.Int, kPosAuftragPosition)
    .input('kShopSubShop', sql.Int, kShopSubShop)
    .query(`
      INSERT INTO Pos.tAuftragPositionMapping (kAuftragPosition, kPosAuftragPosition, kShopSubShop)
      VALUES (@kAuftragPosition, @kPosAuftragPosition, @kShopSubShop)
    `);
}

function isOrderDelivered(order) {
  const deliver = order.settings?.deliver;
  if (deliver === undefined || deliver === null) {
    return true;
  }
  return deliver === true || String(deliver) === '1' || String(deliver).toLowerCase() === 'true';
}

async function recalculateAuftragEckdaten(transaction, kAuftrag) {
  await new sql.Request(transaction).input('kAuftrag', sql.Int, kAuftrag).query(`
    DECLARE @eckdaten_calc Verkauf.TYPE_spAuftragEckdatenBerechnen;
    INSERT INTO @eckdaten_calc VALUES (@kAuftrag);
    EXEC Verkauf.spAuftragEckdatenBerechnen @auftrag = @eckdaten_calc;
  `);
}

async function getOffenerAuftragswert(transaction, kAuftrag) {
  const result = await new sql.Request(transaction)
    .input('kAuftrag', sql.Int, kAuftrag)
    .query(`
      SELECT ROUND(tAuftragEckdaten.fOffenerWertOhneStorno, 2) AS fOffenerAuftragswert
      FROM Verkauf.tAuftrag
      LEFT JOIN Verkauf.tAuftragEckdaten ON tAuftragEckdaten.kAuftrag = tAuftrag.kAuftrag
      WHERE tAuftrag.kAuftrag = @kAuftrag
    `);
  const value = result.recordset[0]?.fOffenerAuftragswert;
  return value == null ? null : toNumber(value, 0);
}

function isNewPayment(payment) {
  const paymentId = toNumber(payment.paymentId, 0);
  return paymentId <= 0;
}

async function insertPayment(transaction, kAuftrag, payment, order, orderDate, zahlungsartCache) {
  const kBenutzer = getActiveUserId();
  const zahlungsart = await resolveZahlungsart(transaction, payment.paymentMethodName || order.paymentMethodName, zahlungsartCache);
  const kZahlung = await allocatePk(transaction, 'tZahlung');

  await recalculateAuftragEckdaten(transaction, kAuftrag);
  const fOffenerWert = await getOffenerAuftragswert(transaction, kAuftrag);
  if (fOffenerWert == null) {
    throw new Error(`no open order amount for kAuftrag=${kAuftrag}`);
  }

  const result = await new sql.Request(transaction)
    .input('kZahlung', sql.Int, kZahlung)
    .input('cName', sql.NVarChar, zahlungsart.cName)
    .input('dDatum', sql.DateTime, orderDate)
    .input('fBetrag', sql.Float, toNumber(payment.amount, 0))
    .input('kBestellung', sql.Int, kAuftrag)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('kZahlungsart', sql.Int, zahlungsart.kZahlungsart)
    .input('cExternalTransactionId', sql.NVarChar, order.externalOrderNumber || '')
    .input('fOffenerWert', sql.Float, fOffenerWert)
    .query(`
      IF EXISTS (
        SELECT 1 FROM Verkauf.tAuftragEckdaten
        WHERE kAuftrag = @kBestellung
          AND ROUND(fOffenerWertOhneStorno, 2) = ROUND(@fOffenerWert, 2)
      )
      BEGIN
        INSERT INTO dbo.tZahlung
          (kZahlung, cName, dDatum, fBetrag, kBestellung, kBenutzer, nAnzahlung, cHinweis, kZahlungsart,
           nKeinExport, cExternalTransactionId, nZuweisungstyp, nZahlungstyp, cZuweisungsinfo, nZuweisungswertung)
        VALUES (@kZahlung, @cName, @dDatum, @fBetrag, @kBestellung, @kBenutzer, 0, '', @kZahlungsart,
           0, @cExternalTransactionId, 0, ${ZAHLUNG_TYPE_ZAHLUNG}, '', 0);
      END
      SELECT @@ROWCOUNT AS inserted;
    `);

  if (!result.recordset[0]?.inserted) {
    throw new Error(`payment insert skipped: open amount changed for kAuftrag=${kAuftrag}`);
  }
}

async function createOrder(order) {
  assertShopConfigured();
  const kShop = getActiveShopId();
  const kFirma = getActiveFirmaId();
  const kBenutzer = getActiveUserId();
  const kSprache = getActiveLanguageId();

  const kPosAuftrag = Number.parseInt(order.externalId, 10);
  const externalOrderNumber = order.externalOrderNumber || '';
  if (Number.isInteger(kPosAuftrag) && kPosAuftrag > 0) {
    const existing = await findExistingPosOrderMapping(kPosAuftrag, externalOrderNumber);
    if (existing) {
      return {
        orderId: String(existing.kAuftrag),
        orderNumber: existing.cAuftragsNr || '',
        alreadyExists: true,
      };
    }
  }

  const transaction = new sql.Transaction(getPool());
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    const kFirmaHistory = await resolveFirmaHistory(transaction, kFirma);
    const kPlattform = await resolvePlattform(transaction);
    const defaultKundengruppe = await resolveDefaultKundengruppe(transaction);

    const zahlungsartCache = new Map();
    const orderDate = parseOrderDate(order.creationDate);
    const { kKunde, kKundengruppe } = await resolveCustomer(transaction, order, kFirma, defaultKundengruppe);
    const zahlungsart = await resolveZahlungsart(transaction, order.paymentMethodName, zahlungsartCache);
    const cAuftragsNr = await nextOrderNumber(transaction, orderDate);

    const orderItems = [...(order.orderItems || [])];
    const shippingName = order.shippingName || order.shippingMethodName || order.shippingMethod;
    const versandArt = await resolveVersandArt(transaction, shippingName);
    const kVersandArt = versandArt.kVersandArt;

    const nIstReadOnly = resolveNIstReadOnly(order);
    const nIstExterneRechnung = resolveNIstExterneRechnung(order);

    const resultAuftrag = await new sql.Request(transaction)
      .input('cAuftragsNr', sql.NVarChar, cAuftragsNr)
      .input('dErstellt', sql.DateTime, orderDate)
      .input('kBenutzer', sql.Int, kBenutzer)
      .input('kKunde', sql.Int, kKunde)
      .input('kFirmaHistory', sql.Int, kFirmaHistory)
      .input('kSprache', sql.Int, kSprache)
      .input('cWaehrung', sql.NVarChar, order.currencyIso || 'EUR')
      .input('kPlattform', sql.Int, kPlattform)
      .input('kShop', sql.Int, kShop)
      .input('cKundenNr', sql.NVarChar, resolveAuftragCKundenNr(order))
      .input('cVersandlandISO', sql.NVarChar, (order.shippingAddress?.countryIso || 'DE').toUpperCase())
      .input('kVersandArt', sql.Int, kVersandArt)
      .input('kZahlungsart', sql.Int, zahlungsart.kZahlungsart)
      .input('kKundengruppe', sql.Int, kKundengruppe)
      .input('cExterneAuftragsnummer', sql.NVarChar, order.externalOrderNumber || '')
      .input('nIstExterneRechnung', sql.Int, nIstExterneRechnung)
      .input('nIstReadOnly', sql.Int, nIstReadOnly)
      .query(`
        DECLARE @t TABLE ([kAuftrag] INT);
        INSERT INTO Verkauf.tAuftrag
          (cAuftragsNr, dErstellt, nKomplettAusgeliefert, kBenutzer, kKunde, kBenutzerErstellt, nType, fFaktor,
           kFirmaHistory, kSprache, cVersandlandWaehrung, fVersandlandWaehrungFaktor, fFinanzierungskosten,
           cWaehrung, kPlattform, kShop, cKundenNr, cVersandlandISO, kVersandArt, kZahlungsart, kKundengruppe,
           cExterneAuftragsnummer, nIstExterneRechnung, cInet, nIstReadOnly, kShopauftrag, nLieferPrioritaet)
        OUTPUT inserted.kAuftrag INTO @t
        VALUES (@cAuftragsNr, @dErstellt, 0, @kBenutzer, @kKunde, @kBenutzer, 1, 1.0,
           @kFirmaHistory, @kSprache, @cWaehrung, 1.0, 0.0,
           @cWaehrung, @kPlattform, @kShop, @cKundenNr, @cVersandlandISO, @kVersandArt, @kZahlungsart, @kKundengruppe,
           @cExterneAuftragsnummer, @nIstExterneRechnung, 'Y', @nIstReadOnly, 0, 10);
        SELECT kAuftrag FROM @t;
      `);

    const kAuftrag = resultAuftrag.recordset[0].kAuftrag;

    const kPosAuftragVal = Number.parseInt(order.externalId, 10);
    await upsertPosOrderMapping(transaction, kAuftrag, kPosAuftragVal);

    await insertOrderText(transaction, kAuftrag, order.note);
    await insertOrderAddress(transaction, kAuftrag, kKunde, order.shippingAddress, 0);
    await insertOrderAddress(transaction, kAuftrag, kKunde, order.billingAddress, 1);

    const deliveredItems = [];
    for (const item of orderItems) {
      const kAuftragPosition = await insertOrderItem(transaction, kAuftrag, item);
      const kPosAuftragPosition = Number.parseInt(item.externalId, 10);
      if (Number.isInteger(kPosAuftragPosition)) {
        await insertPosOrderPositionMapping(transaction, kAuftragPosition, kPosAuftragPosition);
      }
      if (kAuftragPosition != null && !isVersandposition(item)) {
        deliveredItems.push({ kAuftragPosition, quantity: toNumber(item.quantity, 1) });
      }
      logger.info(`createOrder: item sku="${String(item.sku ?? '').trim()}" type=${item.type} kAuftragPosition=${kAuftragPosition} qty=${toNumber(item.quantity, 1)} -> delivered=${kAuftragPosition != null && !isVersandposition(item)}`);
    }

    for (const payment of order.payments || []) {
      if (!isNewPayment(payment)) continue;
      await insertPayment(transaction, kAuftrag, payment, order, orderDate, zahlungsartCache);
    }

    await recalculateAuftragEckdaten(transaction, kAuftrag);

    logger.info(`createOrder: kAuftrag=${kAuftrag} isOrderDelivered=${isOrderDelivered(order)} deliveredItems=${JSON.stringify(deliveredItems)}`);
    if (isOrderDelivered(order)) {
      await deliverOrder(transaction, kBenutzer, kAuftrag, kVersandArt, deliveredItems);
    }

    await new sql.Request(transaction).input('kAuftrag', sql.Int, kAuftrag).query(`
      DECLARE @eckdaten_calc Verkauf.TYPE_spAuftragEckdatenBerechnen;
      INSERT INTO @eckdaten_calc VALUES (@kAuftrag);
      EXEC Verkauf.spAuftragEckdatenBerechnen @auftrag = @eckdaten_calc;
    `);

    await transaction.commit();

    return { orderId: String(kAuftrag), orderNumber: cAuftragsNr, alreadyExists: false };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

module.exports = { createOrder };
