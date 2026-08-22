let sharp = null;
try {
  sharp = require('sharp');
} catch {
  // sharp is optional
}

const MAX_DIMENSION = 200;

async function resizeImage(buffer) {
  if (!sharp) {
    return buffer;
  }
  try {
    return await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}

module.exports = { resizeImage };
