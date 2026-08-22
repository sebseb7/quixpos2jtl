/**
 * Persistent JTL-POS Pairing Store.
 * Manages active pairing PINs and paired POS devices.
 * Persists all state to %ProgramData%/quixpos2jtl/pairing.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR, ensureDirs } = require('../../config');
const { logger } = require('../logger');

const PAIRING_FILE = path.join(CONFIG_DIR, 'pairing.json');

function loadPairingData() {
  ensureDirs();
  try {
    if (fs.existsSync(PAIRING_FILE)) {
      const data = JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf-8'));
      return {
        pairingCodes: Array.isArray(data.pairingCodes) ? data.pairingCodes : [],
        pairedDevices: Array.isArray(data.pairedDevices) ? data.pairedDevices : [],
      };
    }
  } catch {
    // ignore read error
  }
  return {
    pairingCodes: [],
    pairedDevices: [],
  };
}

function savePairingData(data) {
  ensureDirs();
  try {
    fs.writeFileSync(PAIRING_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to save pairing data: ${err.message}`);
  }
}

function createPairingStore() {
  function getPairingState() {
    return loadPairingData();
  }

  function generatePairingCode(name = 'JTL-POS') {
    const data = loadPairingData();
    // 6-digit PIN between 100000 and 999999
    const code = String(crypto.randomInt(100000, 1000000));
    const entry = {
      code,
      name: name || 'JTL-POS',
      createdAt: new Date().toISOString(),
    };

    // Exactly one active PIN — replace any previous PIN
    data.pairingCodes = [entry];

    savePairingData(data);
    logger.info(`Generated new pairing PIN: ${code} for "${name}"`);
    return entry;
  }

  function setPairingCode(code, name = 'JTL-POS') {
    const data = loadPairingData();
    const strCode = String(code).trim();
    if (!strCode) return;

    // Exactly one active PIN — replace any previous PIN
    data.pairingCodes = [{
      code: strCode,
      name: name || 'JTL-POS',
      createdAt: new Date().toISOString(),
    }];

    savePairingData(data);
    logger.info(`Set pairing PIN: ${strCode}`);
  }

  function revokePairingCode() {
    const data = loadPairingData();
    data.pairingCodes = [];
    savePairingData(data);
    logger.info('Revoked active pairing PIN');
  }

  function hasPairingCode(code) {
    const data = loadPairingData();
    const strCode = String(code).trim();
    return data.pairingCodes.some((c) => c.code === strCode);
  }

  function registerDevice(token, name = 'JTL-POS', meta = {}) {
    const data = loadPairingData();
    const strToken = String(token || crypto.randomBytes(16).toString('hex')).trim();
    const now = new Date().toISOString();

    const existingIdx = data.pairedDevices.findIndex((d) => d.token === strToken);
    const deviceEntry = {
      token: strToken,
      name: name || 'JTL-POS',
      clientIp: meta.clientIp || '',
      pairedAt: existingIdx >= 0 ? data.pairedDevices[existingIdx].pairedAt : now,
      lastSeenAt: now,
    };

    if (existingIdx >= 0) {
      data.pairedDevices[existingIdx] = { ...data.pairedDevices[existingIdx], ...deviceEntry };
    } else {
      data.pairedDevices.unshift(deviceEntry);
    }

    savePairingData(data);
    logger.success(`Registered paired POS device: "${deviceEntry.name}" (Token: ${strToken.slice(0, 8)}...)`);
    return strToken;
  }

  function removePairedDevice(token) {
    const data = loadPairingData();
    const strToken = String(token).trim();
    const device = data.pairedDevices.find((d) => d.token === strToken);
    data.pairedDevices = data.pairedDevices.filter((d) => d.token !== strToken);
    savePairingData(data);
    logger.info(`Removed paired device: "${device?.name || strToken}"`);
    return { success: true };
  }

  function touchDevice(token) {
    const data = loadPairingData();
    const strToken = String(token).trim();
    const device = data.pairedDevices.find((d) => d.token === strToken);
    if (device) {
      device.lastSeenAt = new Date().toISOString();
      savePairingData(data);
    }
  }

  function isDeviceAuthorized(token) {
    const data = loadPairingData();
    const strToken = String(token).trim();
    return data.pairedDevices.some((d) => d.token === strToken);
  }

  function getPairedDevices() {
    return loadPairingData().pairedDevices;
  }

  return {
    getPairingState,
    generatePairingCode,
    setPairingCode,
    revokePairingCode,
    hasPairingCode,
    registerDevice,
    removePairedDevice,
    touchDevice,
    isDeviceAuthorized,
    getPairedDevices,
  };
}

module.exports = {
  createPairingStore,
  loadPairingData,
  savePairingData,
  PAIRING_FILE,
};
