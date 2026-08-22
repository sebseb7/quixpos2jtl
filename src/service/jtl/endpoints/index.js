const category = require('./category');
const cimage = require('./cimage');
const client = require('./client');
const crashreport = require('./crashreport');
const customer = require('./customer');
const customergroup = require('./customergroup');
const deletedEntity = require('./deleted-entity');
const init = require('./init');
const newpin = require('./newpin');
const order = require('./order');
const orderSearch = require('./order-search');
const pimage = require('./pimage');
const product = require('./product');
const productcomposite = require('./productcomposite');

const endpoints = [
  client,
  newpin,
  init,
  category,
  product,
  productcomposite,
  deletedEntity,
  pimage,
  cimage,
  customergroup,
  customer,
  order,
  orderSearch,
  crashreport,
];

module.exports = { endpoints };
