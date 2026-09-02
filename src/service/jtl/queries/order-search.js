const sql = require('mssql');
const { getPool } = require('../../db');

function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatBirthday(cDateOfBirth) {
  if (!cDateOfBirth) return null;
  const text = String(cDateOfBirth).trim();
  if (!text) return null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} 00:00:00`;
}

async function searchOrders({ search = '', limit = 50 } = {}) {
  const pool = getPool();
  const trimmed = String(search ?? '').trim();
  const searchPattern = `%${trimmed}%`;

  const orderQuery = `
    SELECT DISTINCT TOP (@limit)
      tAuftrag.kAuftrag AS kOrder,
      tAuftrag.cAuftragsNr AS cOrderNumber,
      tAuftrag.cExterneAuftragsnummer AS cExternalOrderNumber,
      tAuftrag.nBeschreibung AS nDescriptionType,
      tAuftrag.cWaehrung AS cCurrencyIso,
      tAuftragText.cAnmerkung AS cNote,
      tAuftrag.dErstellt AS dCreationDate,
      tAuftrag.dVoraussichtlichesLieferdatum AS dShippingDate,
      tAuftragText.cHinweis AS cComment,
      ISNULL(tSpracheUsed.cISO2, tSpracheUsed.cISO) AS cLanguageIso,
      tversandart.cName AS cShippingName,
      tZahlungsart.cName AS cPaymentMethodName,
      tkunde.cKundenNr AS cCustomerNumber,
      Lieferadresse.cName AS cShippingAddressName,
      Rechnungsadresse.cName AS cBillingAddressName,
      CASE WHEN tRechnung.kRechnung IS NOT NULL
              OR tAuftrag.nIstReadOnly > 0
              OR tAuftrag.nIstExterneRechnung > 0
              OR tLieferschein.kLieferschein IS NOT NULL
              OR Pickliste.nPickliste IS NOT NULL
          THEN CAST(0 AS BIT)
          ELSE CAST(1 AS BIT)
      END AS nChangeable,
      Rechnungsadresse.cFirma AS cBillingAddressCompany,
      Lieferadresse.cFirma AS cShippingAddressCompany,
      tRechnung.cRechnungsnr AS cInvoiceNumber,
      tAuftrag.cKundeUstId AS cTaxId
    FROM Verkauf.tAuftrag
    LEFT JOIN Verkauf.tAuftragText ON tAuftrag.kAuftrag = tAuftragText.kAuftrag
    LEFT JOIN dbo.tversandart ON tAuftrag.kVersandArt = tversandart.kVersandArt
    LEFT JOIN dbo.tSpracheUsed ON tAuftrag.kSprache = tSpracheUsed.kSprache
    LEFT JOIN dbo.tZahlungsart ON tAuftrag.kZahlungsArt = tZahlungsart.kZahlungsart
    LEFT JOIN Verkauf.vAuftragLieferadresse AS Lieferadresse ON tAuftrag.kAuftrag = Lieferadresse.kAuftrag
    LEFT JOIN Verkauf.vAuftragRechnungsadresse AS Rechnungsadresse ON tAuftrag.kAuftrag = Rechnungsadresse.kAuftrag
    LEFT JOIN dbo.tkunde ON tAuftrag.kKunde = tkunde.kKunde
    LEFT JOIN dbo.tLieferschein ON tLieferschein.kBestellung = tAuftrag.kAuftrag
    OUTER APPLY (
        SELECT TOP(1) 1 AS nPickliste
        FROM dbo.tPicklistePos
        WHERE tPicklistePos.kBestellung = tAuftrag.kAuftrag
    ) AS Pickliste
    LEFT JOIN Rechnung.tRechnungPosition ON tRechnungPosition.kAuftrag = tAuftrag.kAuftrag
    LEFT JOIN Rechnung.tRechnung ON tRechnung.kRechnung = tRechnungPosition.kRechnung
    LEFT JOIN Verkauf.tAuftragEckdaten ON tAuftrag.kAuftrag = tAuftragEckdaten.kAuftrag
    WHERE (ISNULL(tAuftragEckdaten.nZahlungStatus, 0) != 2 AND tAuftragEckdaten.dBezahlt IS NULL)
      AND (tAuftrag.nStorno = 0 OR tAuftrag.nStorno IS NULL)
      AND (
        @search = '' OR
      tAuftrag.cAuftragsNr LIKE @searchPattern OR
      tAuftrag.cExterneAuftragsnummer LIKE @searchPattern OR
      tkunde.cKundenNr LIKE @searchPattern OR
      Lieferadresse.cName LIKE @searchPattern OR
      Lieferadresse.cVorname LIKE @searchPattern OR
      Lieferadresse.cFirma LIKE @searchPattern OR
      Rechnungsadresse.cName LIKE @searchPattern OR
      Rechnungsadresse.cVorname LIKE @searchPattern OR
      Rechnungsadresse.cFirma LIKE @searchPattern OR
      tRechnung.cRechnungsnr LIKE @searchPattern OR
      CAST(tAuftrag.kAuftrag AS NVARCHAR(50)) = @search OR
      EXISTS (
        SELECT 1 FROM Verkauf.tAuftragPosition p
        WHERE p.kAuftrag = tAuftrag.kAuftrag
          AND (p.cArtNr LIKE @searchPattern OR p.cName LIKE @searchPattern)
      )
    )
    ORDER BY tAuftrag.kAuftrag DESC
  `;

  const orderRows = (await pool.request()
    .input('limit', sql.Int, limit)
    .input('search', sql.NVarChar, trimmed)
    .input('searchPattern', sql.NVarChar, searchPattern)
    .query(orderQuery)).recordset;

  if (!orderRows.length) {
    return [];
  }

  const orderIds = orderRows.map((r) => Number(r.kOrder)).filter(Number.isInteger);
  if (!orderIds.length) {
    return [];
  }
  const idList = orderIds.join(',');

  const [billingRes, shippingRes, itemsRes, paymentsRes, mappingRes] = await Promise.all([
    pool.request().query(`SELECT * FROM Pos.vOrderBillingAddress WHERE kOrder IN (${idList})`),
    pool.request().query(`SELECT * FROM Pos.vOrderShippingAddress WHERE kOrder IN (${idList})`),
    pool.request().query(`SELECT * FROM Pos.vOrderItem WHERE kOrder IN (${idList}) ORDER BY kOrder, kOrderPos`),
    pool.request().query(`SELECT * FROM Pos.vOrderPayment WHERE kOrder IN (${idList})`),
    pool.request().query(`SELECT kAuftrag, kPosAuftrag FROM Pos.tAuftragMapping WHERE kAuftrag IN (${idList})`),
  ]);

  const billingMap = new Map();
  for (const b of billingRes.recordset) {
    if (!billingMap.has(b.kOrder)) billingMap.set(b.kOrder, b);
  }

  const shippingMap = new Map();
  for (const s of shippingRes.recordset) {
    if (!shippingMap.has(s.kOrder)) shippingMap.set(s.kOrder, s);
  }

  const itemsMap = new Map();
  for (const item of itemsRes.recordset) {
    if (!itemsMap.has(item.kOrder)) itemsMap.set(item.kOrder, []);
    itemsMap.get(item.kOrder).push(item);
  }

  const paymentsMap = new Map();
  for (const p of paymentsRes.recordset) {
    if (!paymentsMap.has(p.kOrder)) paymentsMap.set(p.kOrder, []);
    paymentsMap.get(p.kOrder).push(p);
  }

  const mappingMap = new Map();
  for (const m of mappingRes.recordset) {
    mappingMap.set(m.kAuftrag, m.kPosAuftrag);
  }

  return orderRows.map((row) => {
    const billing = billingMap.get(row.kOrder) || {};
    const shipping = shippingMap.get(row.kOrder) || {};
    const items = itemsMap.get(row.kOrder) || [];
    const payments = paymentsMap.get(row.kOrder) || [];
    const externalId = String(mappingMap.get(row.kOrder) ?? row.cExternalOrderNumber ?? '0');

    return {
      orderId: String(row.kOrder),
      note: row.cNote ?? '',
      creationDate: formatDate(row.dCreationDate) ?? '',
      shippingName: row.cShippingName ?? '',
      shippingInfo: null,
      currencyIso: (row.cCurrencyIso || 'EUR').trim(),
      languageIso: (row.cLanguageIso || 'de').trim(),
      paymentMethodName: row.cPaymentMethodName ?? '',
      orderNumber: row.cOrderNumber ?? '',
      invoiceNumber: row.cInvoiceNumber ?? null,
      externalOrderNumber: row.cExternalOrderNumber ?? null,
      comment: row.cComment ?? '',
      descriptionType: row.nDescriptionType != null ? Number(row.nDescriptionType) : 0,
      customerNumber: row.cCustomerNumber ?? '',
      shippingAddress: {
        firstName: shipping.cFirstName ?? '',
        lastName: shipping.cLastName ?? '',
        company: shipping.cCompany ?? '',
        street: shipping.cStreet ?? '',
        zipCode: shipping.cZip ?? '',
        city: shipping.cCity ?? '',
        phone: shipping.cPhone ?? '',
        fax: shipping.cFax ?? '',
        email: shipping.cMail ?? '',
        salutation: shipping.cSalutation ?? '',
        extraAddressLine: shipping.cExtraAddressLine ?? '',
        mobile: shipping.cMobile ?? '',
        title: shipping.cTitle ?? '',
        deliveryInstruction: shipping.cDeliveryInstruction ?? '',
        state: shipping.cState ?? '',
        countryIso: shipping.cCountryIso ?? 'DE',
      },
      billingAddress: {
        firstName: billing.cFirstName ?? '',
        lastName: billing.cLastName ?? '',
        company: billing.cCompany ?? '',
        street: billing.cStreet ?? '',
        zipCode: billing.cZip ?? '',
        city: billing.cCity ?? '',
        phone: billing.cPhone ?? '',
        fax: billing.cFax ?? '',
        email: billing.cMail ?? '',
        salutation: billing.cSalutation ?? '',
        extraAddressLine: billing.cExtraAddressLine ?? '',
        mobile: billing.cMobile ?? '',
        title: billing.cTitle ?? '',
        state: billing.cState ?? '',
        countryIso: billing.cISO ?? 'DE',
        addressAddition: billing.cAddressAddition ?? null,
        toTheAttention: null,
        discount: billing.fDiscount != null ? Number(billing.fDiscount) : 0,
        customerGroupId: billing.kCustomerGroupId != null ? String(billing.kCustomerGroupId) : '1',
        birthday: billing.cDateOfBirth ? formatBirthday(billing.cDateOfBirth) : null,
      },
      orderItems: items.map((item) => {
        const priceNet = item.fPriceNet != null ? Number(item.fPriceNet) : 0;
        const vat = item.fVat != null ? Number(item.fVat) : 0;
        const priceGross = priceNet * (1 + vat / 100);

        return {
          orderItemId: String(item.kOrderPos),
          priceNet: priceNet.toFixed(2),
          priceGross: priceGross.toFixed(2),
          vat: String(Math.round(vat)),
          quantity: item.nQuantity != null ? String(item.nQuantity) : '1',
          name: item.cName ?? '',
          sku: item.cSku ?? '',
          type: item.nType != null ? Number(item.nType) : 0,
          uniqueId: item.cVoucherId || item.cUsageId || '',
        };
      }),
      ShippingDate: formatDate(row.dShippingDate),
      settings: null,
      payments: payments.map((p) => ({
        paymentId: String(p.kPayment),
        paymentMethodName: p.cPaymentMethodName ?? '',
        amount: p.fAmount != null ? Number(p.fAmount).toFixed(2) : '0.00',
        transactionId: p.cExternalTransactionId ?? '',
        note: p.cNote ?? '',
        type: p.nType != null ? Number(p.nType) : 10,
      })),
      externalId,
      changeable: row.nChangeable ? 'true' : 'false',
      rapRounding: 'false',
      taxIdNumber: row.cTaxId ?? null,
    };
  });
}

module.exports = { searchOrders };
