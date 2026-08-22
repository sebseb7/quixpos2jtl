const { createImageHandler } = require('../image-handler');

const method = 'GET';
const path = '/v1/pimage';
const handle = createImageHandler();

module.exports = {
  method,
  path,
  handle,
};
