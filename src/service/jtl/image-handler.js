const { sendBinary, sendJson } = require('./http');
const { resizeImage } = require('./image-resize');
const { getImageByHash } = require('./queries/image');

function createImageHandler() {
  return async function handle(_req, res, { url }) {
    const path = url.searchParams.get('path');

    if (!path) {
      return sendJson(res, 400, { Message: "Missing required query parameter 'path'." });
    }

    const image = await getImageByHash(path, '200');
    if (!image) {
      return sendJson(res, 404, { Message: `No image was found for path '${path}'.` });
    }

    const buffer = await resizeImage(image.buffer);
    return sendBinary(res, 200, buffer, image.contentType);
  };
}

module.exports = { createImageHandler };
