/**
 * Windows Firewall Rule Manager.
 * Configures inbound TCP firewall rules for QuixPOS2JTL HTTP and HTTPS ports.
 */
const { execSync } = require('child_process');
const { logger } = require('./logger');

const RULE_NAME_HTTP = 'QuixPOS2JTL HTTP';
const RULE_NAME_HTTPS = 'QuixPOS2JTL HTTPS';

function runNetsh(cmd) {
  try {
    execSync(`netsh advfirewall firewall ${cmd}`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configure inbound firewall rules for the given ports.
 * @param {number|string} httpPort 
 * @param {number|string} httpsPort 
 */
function updateFirewallRules(httpPort, httpsPort) {
  if (process.platform !== 'win32') {
    return { success: true, skipped: true };
  }

  const hPort = parseInt(httpPort, 10);
  const sPort = parseInt(httpsPort, 10);

  try {
    // Delete any existing rules first to prevent duplicates / update port numbers
    runNetsh(`delete rule name="${RULE_NAME_HTTP}"`);
    runNetsh(`delete rule name="${RULE_NAME_HTTPS}"`);

    // Add rule for HTTP port if valid
    if (hPort && hPort > 0 && hPort <= 65535) {
      const addedHttp = runNetsh(
        `add rule name="${RULE_NAME_HTTP}" dir=in action=allow protocol=TCP localport=${hPort} profile=any description="Allow QuixPOS2JTL HTTP API"`
      );
      if (addedHttp) {
        logger.info(`Windows Firewall: Allowed inbound TCP port ${hPort} (${RULE_NAME_HTTP})`);
      }
    }

    // Add rule for HTTPS port if valid
    if (sPort && sPort > 0 && sPort <= 65535) {
      const addedHttps = runNetsh(
        `add rule name="${RULE_NAME_HTTPS}" dir=in action=allow protocol=TCP localport=${sPort} profile=any description="Allow QuixPOS2JTL HTTPS POS API"`
      );
      if (addedHttps) {
        logger.info(`Windows Firewall: Allowed inbound TCP port ${sPort} (${RULE_NAME_HTTPS})`);
      }
    }

    return { success: true };
  } catch (err) {
    logger.warn(`Windows Firewall configuration note: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Remove firewall rules for QuixPOS2JTL.
 */
function removeFirewallRules() {
  if (process.platform !== 'win32') {
    return { success: true, skipped: true };
  }

  try {
    runNetsh(`delete rule name="${RULE_NAME_HTTP}"`);
    runNetsh(`delete rule name="${RULE_NAME_HTTPS}"`);
    logger.info('Windows Firewall: Removed QuixPOS2JTL inbound rules');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  updateFirewallRules,
  removeFirewallRules,
  RULE_NAME_HTTP,
  RULE_NAME_HTTPS,
};
