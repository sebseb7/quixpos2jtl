/**
 * Certificate generation and management.
 * Uses `selfsigned` to create a self-signed TLS certificate.
 * Certs are stored in %APPDATA%/quixpos2jtl/certs/
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const selfsigned = require('selfsigned');
const { CERTS_DIR, ensureDirs } = require('../config');
const { readCertMetadata } = require('./jtl/cert-meta');

const CERT_FILE = path.join(CERTS_DIR, 'server.crt');
const KEY_FILE = path.join(CERTS_DIR, 'server.key');

/**
 * Retrieve local active IPv4 addresses and hostname for IP suggestions.
 * @returns {{ hostname: string, addresses: Array<{ interface: string, address: string }>, ips: string[] }}
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const netIf of interfaces[name] || []) {
      if (netIf.family === 'IPv4' || netIf.family === 4) {
        if (!netIf.internal && netIf.address) {
          addresses.push({ interface: name, address: netIf.address });
        }
      }
    }
  }
  return {
    hostname: os.hostname() || 'localhost',
    addresses,
    ips: addresses.map(a => a.address),
  };
}

/**
 * Generate a new self-signed certificate.
 * Supports custom Common Name (IP or hostname) and additional Subject Alternative Names.
 * Overwrites any existing cert.
 * @param {string|{ commonName?: string, altNames?: string|string[], days?: number, notAfterDate?: Date }} [options]
 * @returns {Promise<{ cert: string, key: string, commonName: string, altNames: Array<{ type: number, ip?: string, value?: string }> }>}
 */
async function generateCert(options = {}) {
  ensureDirs();

  let commonName = 'localhost';
  let userAltNames = [];

  if (typeof options === 'string') {
    commonName = options.trim() || 'localhost';
  } else if (typeof options === 'object' && options !== null) {
    if (options.commonName && typeof options.commonName === 'string') {
      commonName = options.commonName.trim() || 'localhost';
    }
    if (Array.isArray(options.altNames)) {
      userAltNames = options.altNames;
    } else if (typeof options.altNames === 'string') {
      userAltNames = options.altNames.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    }
  }

  const altNames = [];
  const addAltName = (val) => {
    if (!val || typeof val !== 'string') return;
    const trimmed = val.trim();
    if (!trimmed) return;

    const isIp = net.isIP(trimmed) !== 0;
    if (isIp) {
      if (!altNames.some(a => a.type === 7 && a.ip === trimmed)) {
        altNames.push({ type: 7, ip: trimmed });
      }
    } else {
      if (!altNames.some(a => a.type === 2 && a.value === trimmed)) {
        altNames.push({ type: 2, value: trimmed });
      }
    }
  };

  // Primary CN first
  addAltName(commonName);

  // User-provided additional SANs
  userAltNames.forEach(addAltName);

  // Always ensure localhost & 127.0.0.1 are present for local requests
  addAltName('localhost');
  addAltName('127.0.0.1');

  const attrs = [{ name: 'commonName', value: commonName }];

  const notAfterDate = (typeof options === 'object' && options?.notAfterDate)
    ? options.notAfterDate
    : new Date(Date.now() + ((typeof options === 'object' && options?.days) || 3650) * 24 * 60 * 60 * 1000);

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    notAfterDate,
    extensions: [
      { name: 'subjectAltName', altNames },
    ],
  });

  fs.writeFileSync(CERT_FILE, pems.cert, 'utf-8');
  fs.writeFileSync(KEY_FILE, pems.private, 'utf-8');

  return { cert: pems.cert, key: pems.private, commonName, altNames };
}

/**
 * Load existing certificate and key from disk.
 * Returns null if not found.
 */
function loadCert() {
  try {
    const cert = fs.readFileSync(CERT_FILE, 'utf-8');
    const key = fs.readFileSync(KEY_FILE, 'utf-8');
    return { cert, key };
  } catch {
    return null;
  }
}

/**
 * Get the public key (certificate) PEM for display/export.
 */
function getPublicKeyPem() {
  try {
    return fs.readFileSync(CERT_FILE, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check whether a certificate exists on disk.
 */
function certExists() {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

/**
 * Get comprehensive info about the current certificate.
 */
function getCertInfo() {
  const pem = getPublicKeyPem();
  const exists = certExists();
  const meta = pem ? readCertMetadata(pem) : null;
  return { exists, publicKey: pem, meta };
}

module.exports = {
  generateCert,
  loadCert,
  getPublicKeyPem,
  certExists,
  getCertInfo,
  getLocalIpAddresses,
  CERT_FILE,
  KEY_FILE,
};
