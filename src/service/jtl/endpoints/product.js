const { sendJson } = require('../http');
const { getProductList } = require('../queries/product-list');

const method = 'GET';
const path = '/v1/product';

const STATIC_DEFAULTS = {
  sort: '0',
  p_price: '0.00',
  discountable: '0',
  deposit: '0',
  discount: '',
  d_price: '0.0',
  tax_rate2: '',
  use_in_out_tax: '0',
  barcode: null,
  use_stock: '0',
  q_div: '0',
  quantity: '0',
  unit: null,
  single_bookable: '0',
  annotation: '',
  status: '0',
  tags: '',
  is_parent: '0',
  parent: '0',
  variants: '',
  print_kitchen_receipt: '0',
  deposit_name: '',
  updated_at: '0001-01-01 00:00:00',
  isCompositeProduct: '0',
  attributes: [],
  configurationGroups: '',
  options: null,
  hasBestBeforeDate: '0',
  hasLotNumber: '0',
  hasSerialNumber: '0',
  PLU: '',
  short_description: '',
  minStock: '0',
  container: [],
  reservedQuantity: '0.00',
  deliveryDetails: [],
  isbn: '',
  manufacturerName: null,
  han: null,
  productType: '0',
  voucherData: null,
  inputPrice: '0',
  inputQuantity: '0',
};

async function handle(_req, res, { url }) {
  const cursor = Number(url.searchParams.get('lastChangedProduct')) || 0;
  const limit = Number(url.searchParams.get('limit')) || 20;

  const products = await getProductList({ cursor, limit });

  return sendJson(
    res,
    200,
    products.map((product) => ({
      ...STATIC_DEFAULTS,
      ...product,
    }))
  );
}

module.exports = {
  method,
  path,
  handle,
};
