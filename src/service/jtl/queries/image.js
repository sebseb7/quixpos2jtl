const sql = require('mssql');
const { getPool } = require('../../db');

const IMAGE_BY_HASH_SQL = `
SELECT bBild, bVorschauBild, nBreite, nHoehe, nVorschauBreite, nVorschauHoehe, cQuelle
FROM dbo.tBild
WHERE cHash = @hash;
`;

function contentTypeFor(cQuelle) {
  const extension = (cQuelle || '').split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

async function getImageByHash(hash, size) {
  const result = await getPool().request().input('hash', sql.NVarChar, hash).query(IMAGE_BY_HASH_SQL);

  const row = result.recordset[0];
  if (!row) {
    return null;
  }

  const previewMaxDimension = Math.max(row.nVorschauBreite || 0, row.nVorschauHoehe || 0);
  const useFull = !previewMaxDimension || Number(size) > previewMaxDimension;
  const buffer = useFull ? row.bBild : row.bVorschauBild;

  if (!buffer) {
    return null;
  }

  return { buffer, contentType: contentTypeFor(row.cQuelle) };
}

module.exports = { getImageByHash };
