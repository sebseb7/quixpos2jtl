const { sendJson } = require('../http');
const { getCategoryCount } = require('../queries/category-count');
const { getMaxOrderIdCount } = require('../queries/max-order-id');
const { getCompositeProductCount } = require('../queries/composite-product-count');
const { getCustomerCount } = require('../queries/customer-count');
const { getCustomerGroupCount } = require('../queries/customer-groups');
const { getDeletedEntityCount } = require('../queries/deleted-entity-count');
const { getProductCount } = require('../queries/product-count');

const method = 'GET';
const path = '/v1/init';

async function handle(_req, res, { url }) {
  const productCursor = Number(url.searchParams.get('lastChangedProduct')) || 0;
  const categoryCursor = Number(url.searchParams.get('lastChangedCategory')) || 0;
  const customerCursor = Number(url.searchParams.get('lastChangedCustomer')) || 0;
  const customerGroupCursor = Number(url.searchParams.get('lastChangedCustomerGroup')) || 0;
  const compositeProductCursor = Number(url.searchParams.get('lastChangedCompositeProduct')) || 0;
  const deletedEntityCursor = Number(url.searchParams.get('lastChangedDeletedEntity')) || 0;

  const [
    productCount,
    categoryCount,
    customerCount,
    customerGroupCount,
    compositeProductCount,
    deletedEntityCount,
    maxOrderIdCount,
  ] = await Promise.all([
    getProductCount({ cursor: productCursor }),
    getCategoryCount({ cursor: categoryCursor }),
    getCustomerCount({ cursor: customerCursor }),
    getCustomerGroupCount({ cursor: customerGroupCursor }),
    getCompositeProductCount({ cursor: compositeProductCursor }),
    getDeletedEntityCount({ cursor: deletedEntityCursor }),
    getMaxOrderIdCount(),
  ]);

  return sendJson(res, 200, {
    version: '1.10.12.0',
    product_count: String(productCount),
    category_count: String(categoryCount),
    customer_count: String(customerCount),
    customerGroup_count: String(customerGroupCount),
    compositeProduct_count: String(compositeProductCount),
    configurationGroup_count: '0',
    configurationItem_count: '0',
    deletedEntity_count: String(deletedEntityCount),
    max_orderId_count: String(maxOrderIdCount),
  });
}

module.exports = {
  method,
  path,
  handle,
};
