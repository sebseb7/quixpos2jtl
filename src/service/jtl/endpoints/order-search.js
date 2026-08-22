const { sendJson } = require('../http');

const method = 'GET';
const path = '/v1/order';

function shippingAddress(overrides = {}) {
  return {
    firstName: 'Max',
    lastName: 'Mustermann',
    company: 'Muster GmbH',
    street: 'Hauptstraße 1',
    zipCode: '12345',
    city: 'Musterstadt',
    phone: '030 123456',
    fax: '030 123457',
    email: 'max@example.com',
    salutation: 'Herr',
    extraAddressLine: '',
    mobile: '0170 123456',
    title: '',
    deliveryInstruction: '',
    state: '',
    countryIso: 'DE',
    ...overrides,
  };
}

function billingAddress(overrides = {}) {
  return {
    firstName: 'Max',
    lastName: 'Mustermann',
    company: 'Muster GmbH',
    street: 'Hauptstraße 1',
    zipCode: '12345',
    city: 'Musterstadt',
    phone: '030 123456',
    fax: '030 123457',
    email: 'max@example.com',
    salutation: 'Herr',
    extraAddressLine: '',
    mobile: '0170 123456',
    title: '',
    state: '',
    countryIso: 'DE',
    addressAddition: null,
    toTheAttention: null,
    discount: 0,
    customerGroupId: '1',
    birthday: null,
    ...overrides,
  };
}

function orderItem(overrides = {}) {
  return {
    orderItemId: '55',
    priceNet: '9.90',
    priceGross: '11.78',
    vat: '19',
    quantity: '1',
    name: 'Artikel A',
    sku: 'SKU-1',
    type: 0,
    uniqueId: 'var-123',
    ...overrides,
  };
}

const DUMMY_ORDERS = [
  {
    orderId: '123',
    note: 'Bitte schnell liefern',
    creationDate: '2026-08-10 14:30:00',
    shippingName: 'Standardversand',
    shippingInfo: 'Paketdienst',
    currencyIso: 'EUR',
    languageIso: 'de',
    paymentMethodName: 'Bar',
    orderNumber: 'WA-2026-0001',
    invoiceNumber: 'RE-2026-0001',
    externalOrderNumber: 'POS-1001',
    comment: 'Kunde wünscht Nachmittagslieferung',
    descriptionType: 0,
    customerNumber: 'K1001',
    shippingAddress: shippingAddress(),
    billingAddress: billingAddress(),
    orderItems: [
      orderItem(),
      orderItem({
        orderItemId: '56',
        priceNet: '4.50',
        priceGross: '5.36',
        name: 'Artikel B',
        sku: 'SKU-2',
        type: 0,
        uniqueId: 'var-456',
      }),
    ],
    ShippingDate: '2026-08-11 10:00:00',
    settings: null,
    payments: [],
    externalId: '0',
    changeable: 'true',
    rapRounding: 'false',
    taxIdNumber: null,
  },
  {
    orderId: '124',
    note: '',
    creationDate: '2026-08-11 11:00:00',
    shippingName: 'Expressversand',
    shippingInfo: 'Express',
    currencyIso: 'EUR',
    languageIso: 'de',
    paymentMethodName: 'Kartenzahlung',
    orderNumber: 'WA-2026-0002',
    invoiceNumber: 'RE-2026-0002',
    externalOrderNumber: 'POS-1002',
    comment: '',
    descriptionType: 0,
    customerNumber: 'K1002',
    shippingAddress: shippingAddress({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      email: 'erika@example.com',
      salutation: 'Frau',
    }),
    billingAddress: billingAddress({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      email: 'erika@example.com',
      salutation: 'Frau',
    }),
    orderItems: [
      orderItem({
        orderItemId: '57',
        priceNet: '14.90',
        priceGross: '17.73',
        name: 'Artikel C',
        sku: 'SKU-3',
        type: 0,
        uniqueId: 'var-789',
      }),
    ],
    ShippingDate: '2026-08-11 16:00:00',
    settings: null,
    payments: [],
    externalId: '0',
    changeable: 'true',
    rapRounding: 'false',
    taxIdNumber: null,
  },
  {
    orderId: '125',
    note: '',
    creationDate: '2026-08-12 09:15:00',
    shippingName: 'Selbstabholer',
    shippingInfo: null,
    currencyIso: 'EUR',
    languageIso: 'de',
    paymentMethodName: 'Rechnung',
    orderNumber: 'WA-2026-0003',
    invoiceNumber: null,
    externalOrderNumber: null,
    comment: 'Storniert laut Kundenwunsch',
    descriptionType: 0,
    customerNumber: 'K1003',
    shippingAddress: shippingAddress({
      lastName: 'Beispiel',
      company: 'Beispiel & Co. KG',
      email: 'office@beispiel.de',
    }),
    billingAddress: billingAddress({
      lastName: 'Beispiel',
      company: 'Beispiel & Co. KG',
      email: 'office@beispiel.de',
    }),
    orderItems: [
      orderItem({
        orderItemId: '58',
        priceNet: '19.90',
        priceGross: '23.68',
        name: 'Artikel D',
        sku: 'SKU-4',
        type: 0,
        uniqueId: 'var-101112',
      }),
    ],
    ShippingDate: null,
    settings: null,
    payments: [],
    externalId: '0',
    changeable: 'true',
    rapRounding: 'false',
    taxIdNumber: null,
  },
];

async function handle(_req, res, { url }) {
  return sendJson(res, 200, DUMMY_ORDERS);
}

module.exports = {
  method,
  path,
  handle,
};
