/**
 * Certificate generation and management.
 * Uses `selfsigned` to create a self-signed TLS certificate.
 * Certs are stored in %APPDATA%/quixpos2jtl/certs/
 */
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { CERTS_DIR, ensureDirs } = require('../config');

const CERT_FILE = path.join(CERTS_DIR, 'server.crt');
const KEY_FILE = path.join(CERTS_DIR, 'server.key');

/**
 * Generate a new self-signed certificate.
 * Overwrites any existing cert.
 * @returns {{ cert: string, key: string }} PEM strings
 */
function generateCert() {
  ensureDirs();
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ]},
    ],
  });

  fs.writeFileSync(CERT_FILE, pems.cert, 'utf-8');
  fs.writeFileSync(KEY_FILE, pems.private, 'utf-8');

  return { cert: pems.cert, key: pems.private };
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

module.exports = { generateCert, loadCert, getPublicKeyPem, certExists, CERT_FILE, KEY_FILE };
