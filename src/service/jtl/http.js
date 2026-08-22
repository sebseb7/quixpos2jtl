function serverTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function readBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, statusCode, body) {
  const responseBody = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(responseBody),
    ...CORS_HEADERS,
  });
  res.end(responseBody);
}

function sendBinary(res, statusCode, buffer, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...CORS_HEADERS,
  });
  res.end(buffer);
}

function sendCorsPreflight(res) {
  res.writeHead(204, {
    'Content-Length': 0,
    ...CORS_HEADERS,
  });
  res.end();
}

function normalizePath(pathname) {
  return pathname.replace(/^\/api(?=\/v1\/)/, '');
}

module.exports = {
  serverTimestamp,
  readBody,
  sendJson,
  sendBinary,
  sendCorsPreflight,
  normalizePath,
};
