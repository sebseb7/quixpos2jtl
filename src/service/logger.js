/**
 * Centralized service logger.
 * Writes formatted logs to:
 *  1. Console stdout/stderr
 *  2. Rolling log file in %ProgramData%/quixpos2jtl/logs/service.log
 *  3. In-memory ring buffer (accessible via GET /api/logs or IPC)
 *  4. Electron parent process (if running embedded with process.send)
 */
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config');

const LOGS_DIR = path.join(CONFIG_DIR, 'logs');
const SERVICE_LOG_FILE = path.join(LOGS_DIR, 'service.log');
const REQUEST_LOG_FILE = path.join(LOGS_DIR, 'requests.log');
const ORDER_LOG_FILE = path.join(LOGS_DIR, 'orders.log');

const MAX_RING_BUFFER = 500;
const ringBuffer = [];
let logIdSequence = 0;

try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  // ignore
}

let serviceLogStream = null;
let requestLogStream = null;
let orderLogStream = null;

function getServiceLogStream() {
  if (!serviceLogStream) {
    try {
      serviceLogStream = fs.createWriteStream(SERVICE_LOG_FILE, { flags: 'a', encoding: 'utf-8' });
    } catch {
      // ignore
    }
  }
  return serviceLogStream;
}

function getRequestLogStream() {
  if (!requestLogStream) {
    try {
      requestLogStream = fs.createWriteStream(REQUEST_LOG_FILE, { flags: 'a', encoding: 'utf-8' });
    } catch {
      // ignore
    }
  }
  return requestLogStream;
}

function getOrderLogStream() {
  if (!orderLogStream) {
    try {
      orderLogStream = fs.createWriteStream(ORDER_LOG_FILE, { flags: 'a', encoding: 'utf-8' });
    } catch {
      // ignore
    }
  }
  return orderLogStream;
}

function pushLog(level, message, meta = null) {
  const ts = new Date().toISOString();
  const entry = {
    id: ++logIdSequence,
    timestamp: ts,
    level, // 'INFO' | 'OK' | 'WARN' | 'ERROR'
    message: typeof message === 'string' ? message : JSON.stringify(message),
    meta,
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_RING_BUFFER) {
    ringBuffer.shift();
  }

  const line = `[${ts}] [${level}] ${entry.message}\n`;
  try {
    const stream = getServiceLogStream();
    if (stream) stream.write(line);
  } catch {
    // ignore
  }

  // Console output
  if (level === 'ERROR') {
    console.error(line.trim());
  } else if (level === 'WARN') {
    console.warn(line.trim());
  } else {
    console.log(line.trim());
  }

  // Send to parent process (Electron) if forked
  if (process.send) {
    try {
      process.send({ type: 'log-entry', entry });
    } catch {
      // ignore
    }
  }

  return entry;
}

const logger = {
  info(msg, meta) { return pushLog('INFO', msg, meta); },
  success(msg, meta) { return pushLog('OK', msg, meta); },
  warn(msg, meta) { return pushLog('WARN', msg, meta); },
  error(msg, meta) { return pushLog('ERROR', msg, meta); },

  logRequest({ remoteAddress, method, url, statusCode, durationMs, response }) {
    const ts = new Date().toISOString();
    const line = `${ts} ${remoteAddress || '127.0.0.1'} ${method} ${url} ${statusCode} ${durationMs}ms ${response || ''}\n`;
    try {
      const stream = getRequestLogStream();
      if (stream) stream.write(line);
    } catch {
      // ignore
    }
    const level = statusCode >= 500 ? 'ERROR' : (statusCode >= 400 ? 'WARN' : 'INFO');
    pushLog(level, `${remoteAddress || '127.0.0.1'} ${method} ${url} ${statusCode} (${durationMs}ms)`);
  },

  logOrder(order) {
    const ts = new Date().toISOString();
    const externalId = order?.externalId ?? '';
    const line = `${ts} externalId=${externalId} ${JSON.stringify(order)}\n`;
    try {
      const stream = getOrderLogStream();
      if (stream) stream.write(line);
    } catch {
      // ignore
    }
    pushLog('OK', `Order logged: externalId=${externalId}`);
  },

  getRecentLogs(sinceId = 0, limit = 200, levelFilter = null) {
    let logs = ringBuffer.filter((l) => l.id > sinceId);
    if (levelFilter && levelFilter !== 'ALL') {
      logs = logs.filter((l) => l.level === levelFilter);
    }
    return logs.slice(-limit);
  },

  clearMemoryLogs() {
    ringBuffer.length = 0;
  },

  close() {
    if (serviceLogStream) { serviceLogStream.end(); serviceLogStream = null; }
    if (requestLogStream) { requestLogStream.end(); requestLogStream = null; }
    if (orderLogStream) { orderLogStream.end(); orderLogStream = null; }
  },
};

module.exports = {
  logger,
  LOGS_DIR,
  SERVICE_LOG_FILE,
  REQUEST_LOG_FILE,
  ORDER_LOG_FILE,
};
