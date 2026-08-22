const { createImageHandler } = require('../image-handler');

const method = 'GET';
const path = '/v1/cimage';
const handle = createImageHandler();

module.exports = {
  method,
  path,
  handle,
};
