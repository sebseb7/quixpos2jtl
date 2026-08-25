/**
 * Standalone service install script.
 * Run this with admin privileges to register the Windows service.
 *
 * Usage: node src/service/install.js
 *        node src/service/install.js --uninstall
 *        node src/service/install.js --start
 *        node src/service/install.js --stop
 */
const path = require('path');
const { Service } = require('node-windows');
const { loadConfig } = require('../config');
const { updateFirewallRules, removeFirewallRules } = require('./firewall');
const { logger } = require('./logger');

const SERVICE_NAME = 'QuixPOS2JTL';
const SERVER_SCRIPT = path.join(__dirname, 'server.js');

logger.info(`[Installer] Script initialized. Target: ${SERVER_SCRIPT}`);
logger.info(`[Installer] Node runtime: ${process.execPath}`);
logger.info(`[Installer] Arguments: ${process.argv.slice(2).join(' ') || '(install)'}`);

const svc = new Service({
  name: SERVICE_NAME,
  description: 'QuixPOS2JTL REST API Service',
  script: SERVER_SCRIPT,
  stopparentfirst: 'no',
  abortOnError: false,
  nodeOptions: [],
  env: [
    {
      name: 'NODE_ENV',
      value: 'production',
    },
    {
      name: 'ELECTRON_RUN_AS_NODE',
      value: '1',
    },
  ],
});

const isUninstall = process.argv.includes('--uninstall');
const isStart = process.argv.includes('--start');
const isStop = process.argv.includes('--stop');

if (isUninstall) {
  logger.info('[Installer] Executing service uninstallation...');
  try {
    removeFirewallRules();
    logger.info('[Installer] Firewall rules removed');
  } catch (err) {
    logger.warn(`[Installer] Firewall removal note: ${err.message}`);
  }

  const { execSync } = require('child_process');
  const cleanScm = () => {
    const names = [SERVICE_NAME, `${SERVICE_NAME.toLowerCase()}.exe`, 'quixpos2jtl.exe'];
    for (const name of names) {
      try { execSync(`net stop "${name}"`, { stdio: 'ignore', shell: 'cmd.exe' }); } catch { /* ignore */ }
      try { execSync(`sc.exe stop "${name}"`, { stdio: 'ignore', shell: 'cmd.exe' }); } catch { /* ignore */ }
      try { execSync(`sc.exe delete "${name}"`, { stdio: 'ignore', shell: 'cmd.exe' }); } catch { /* ignore */ }
    }
  };

  svc.on('uninstall', () => {
    logger.success('[Installer] Service uninstalled successfully (winsw)');
    cleanScm();
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('alreadyuninstalled', () => {
    logger.info('[Installer] Service is already uninstalled');
    cleanScm();
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('doesnotexist', () => {
    logger.info('[Installer] Service does not exist in SCM');
    cleanScm();
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('invalidinstallation', () => {
    logger.info('[Installer] Service installation invalid or not found');
    cleanScm();
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('error', (err) => {
    const msg = err?.message || String(err);
    logger.error(`[Installer] Uninstall error: ${msg}`);
    cleanScm();
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.uninstall();
} else if (isStart) {
  logger.info('[Installer] Starting service via node-windows...');
  svc.on('start', () => {
    logger.success('[Installer] Service started event received');
    console.log('SERVICE_STARTED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('error', (err) => {
    const msg = err?.message || String(err);
    logger.error(`[Installer] Start error: ${msg}`);
    console.error('SERVICE_ERROR:' + msg);
    process.exit(1);
  });

  svc.start();
  setTimeout(() => {
    logger.info('[Installer] Service start timeout reached (assuming started)');
    console.log('SERVICE_STARTED');
    process.exit(0);
  }, 3000);
} else if (isStop) {
  logger.info('[Installer] Stopping service via node-windows...');
  svc.on('stop', () => {
    logger.success('[Installer] Service stopped event received');
    console.log('SERVICE_STOPPED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('alreadystopped', () => {
    logger.info('[Installer] Service is already stopped');
    console.log('SERVICE_STOPPED');
    setTimeout(() => process.exit(0), 500);
  });

  svc.on('error', (err) => {
    const msg = err?.message || String(err);
    logger.error(`[Installer] Stop error: ${msg}`);
    console.error('SERVICE_ERROR:' + msg);
    process.exit(1);
  });

  svc.stop();
  setTimeout(() => {
    logger.info('[Installer] Service stop timeout reached');
    console.log('SERVICE_STOPPED');
    process.exit(0);
  }, 3000);
} else {
  logger.info('[Installer] Registering Windows Service via node-windows (winsw)...');

  svc.on('install', () => {
    logger.success('[Installer] Windows Service registered successfully in SCM!');
    console.log('SERVICE_INSTALLED');
    const cfg = loadConfig();
    try {
      updateFirewallRules(cfg.network?.httpPort || 8087, cfg.network?.httpsPort || 4447);
      logger.info(`[Installer] Windows Firewall configured for HTTP:${cfg.network?.httpPort || 8087} and HTTPS:${cfg.network?.httpsPort || 4447}`);
    } catch (err) {
      logger.warn(`[Installer] Firewall rule note: ${err.message}`);
    }
    logger.info('[Installer] Starting newly registered Windows Service...');
    svc.start();
    setTimeout(() => process.exit(0), 3000);
  });

  svc.on('alreadyinstalled', () => {
    logger.warn('[Installer] Windows Service is already registered in SCM');
    console.log('SERVICE_ALREADY_INSTALLED');
    const cfg = loadConfig();
    try {
      updateFirewallRules(cfg.network?.httpPort || 8087, cfg.network?.httpsPort || 4447);
    } catch (err) {
      logger.warn(`[Installer] Firewall rule note: ${err.message}`);
    }
    logger.info('[Installer] Starting existing Windows Service...');
    svc.start();
    setTimeout(() => process.exit(0), 2000);
  });

  svc.on('error', (err) => {
    const msg = err?.message || String(err);
    logger.error(`[Installer] Service install error: ${msg}`);
    console.error('SERVICE_ERROR:' + msg);
    process.exit(1);
  });

  try {
    svc.install();
  } catch (err) {
    logger.error(`[Installer] Exception during svc.install(): ${err.message}`);
    console.error('SERVICE_ERROR:' + err.message);
    process.exit(1);
  }
}

// Fallback timeout
setTimeout(() => {
  logger.error('[Installer] Operation timed out after 30 seconds');
  console.error('SERVICE_ERROR:Operation timed out');
  process.exit(1);
}, 30000);
