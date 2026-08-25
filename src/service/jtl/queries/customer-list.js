const sql = require('mssql');
const { getPool } = require('../../db');
const { getActiveShopId } = require('../shop');

const CUSTOMER_LIST_SQL = `
SELECT TOP (@Limit)
    vCustomer.kId,
    vCustomer.cCustomerNumber,
    vCustomer.cFirstName,
    vCustomer.cLastName,
    vCustomer.cTitle,
    vCustomer.cCompany,
    vCustomer.cAddress,
    vCustomer.cAddressSupplement,
    vCustomer.cCity,
    vCustomer.cPostalCode,
    vCustomer.cState,
    vCustomer.cCountry,
    vCustomer.cPhone,
    vCustomer.cEmailAddress,
    vCustomer.kCustomerGroupId,
    vCustomer.cSalutation,
    vCustomer.cDateOfBirth,
    vCustomer.fDiscount,
    vCustomer.cFederalTaxId,
    CONVERT(BIGINT, vCustomer.bLastChanged) AS lastChanged,
    vCustomer.kShop,
    vCustomer.dLastModified,
    vCustomer.dActive,
    vCustomer.dInactive,
    vCustomer.nDebtorNumber
FROM Pos.vCustomer
WHERE vCustomer.kShop = @ShopId
  AND CONVERT(BIGINT, vCustomer.bLastChanged) > @bLastChanged
ORDER BY vCustomer.bLastChanged ASC;
`;

function formatBirthday(cDateOfBirth) {
  if (!cDateOfBirth) {
    return null;
  }
  const text = String(cDateOfBirth).trim();
  if (!text) {
    return null;
  }
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (!match) {
    return null;
  }
  const [, day, month, year] = match;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} 00:00:00`;
}

async function getCustomerList({ cursor = 0, limit = 20 } = {}) {
  const result = await getPool()
    .request()
    .input('Limit', sql.Int, limit)
    .input('ShopId', sql.Int, getActiveShopId())
    .input('bLastChanged', sql.BigInt, cursor)
    .query(CUSTOMER_LIST_SQL);

  return result.recordset.map((row) => ({
    id: String(row.kId),
    customerNumber: row.cCustomerNumber ?? null,
    firstname: row.cFirstName ?? null,
    lastname: row.cLastName ?? null,
    title: row.cTitle ?? null,
    company: row.cCompany ?? null,
    address: row.cAddress ?? null,
    addressSupplement: row.cAddressSupplement ?? null,
    city: row.cCity ?? null,
    postalCode: row.cPostalCode ?? null,
    state: row.cState ?? null,
    country: row.cCountry ?? null,
    phone: row.cPhone ?? null,
    email: row.cEmailAddress ?? null,
    customerGroupId: String(row.kCustomerGroupId),
    salutation: row.cSalutation ?? null,
    birthday: formatBirthday(row.cDateOfBirth),
    discount: Number(row.fDiscount).toFixed(2),
    taxIdNumber: row.cFederalTaxId ?? null,
    lastChanged: String(row.lastChanged),
    debtorNumber: String(row.nDebtorNumber ?? 0),
  }));
}

module.exports = { getCustomerList };
