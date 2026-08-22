const fs = require('fs');
const path = require('path');
const { sendJson } = require('../http');
const { logger, LOGS_DIR } = require('../../logger');

const method = 'POST';
const pathEndpoint = '/v1/crashreport';

const CRASH_LOG_DIR = path.join(LOGS_DIR, 'crash');

function sanitizeIp(ip) {
  const value = String(ip || '0.0.0.0');
  const withoutPrefix = value.replace(/^::ffff:/, '');
  return withoutPrefix.replace(/[:]/g, '_');
}

function timestampPart() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function parseBody(buffer) {
  if (!buffer || !buffer.length) {
    return {};
  }
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
}

function handle(req, res) {
  const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
  const ip = sanitizeIp(remoteAddress);
  const body = parseBody(req.rawBody);

  if (body === null) {
    return sendJson(res, 400, { Message: 'Invalid JSON body.' });
  }

  const fileName = `${timestampPart()}-${ip}.txt`;
  const filePath = path.join(CRASH_LOG_DIR, fileName);

  try {
    fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    const lines = [
      `timestamp: ${new Date().toISOString()}`,
      `ip: ${remoteAddress}`,
      `user-agent: ${req.headers['user-agent'] ?? ''}`,
      '',
      JSON.stringify(body, null, 2),
      '',
    ];
    fs.writeFileSync(filePath, lines.join('\n'));
    logger.warn(`crash report saved to ${filePath}`);
  } catch (err) {
    logger.error(`failed to save crash report: ${err.message}`);
  }

  return sendJson(res, 200, { Message: 'OK', file: fileName });
}

module.exports = {
  method,
  path: pathEndpoint,
  handle,
};
