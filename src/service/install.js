/**
 * Standalone service install script.
 * Run this with admin privileges to register the Windows service.
 *
 * Usage: node src/service/install.js
 *        node src/service/install.js --uninstall
 */
const path = require('path');
const { Service } = require('node-windows');
const { loadConfig } = require('../config');
const { updateFirewallRules, removeFirewallRules } = require('./firewall');

const SERVICE_NAME = 'QuixPOS2JTL';
const SERVER_SCRIPT = path.join(__dirname, 'server.js');

const svc = new Service({
  name: SERVICE_NAME,
  description: 'QuixPOS2JTL REST API Service',
  script: SERVER_SCRIPT,
  stopparentfirst: 'no',
  abortOnError: false,
  nodeOptions: [],
  env: [{
    name: 'NODE_ENV',
    value: 'production',
  }],
});

const isUninstall = process.argv.includes('--uninstall');
const isStart = process.argv.includes('--start');
const isStop = process.argv.includes('--stop');

if (isUninstall) {
  removeFirewallRules();
  svc.on('uninstall', () => {
    console.log('SERVICE_UNINSTALLED');
    setTimeout(() => process.exit(0), 500);
  });
  svc.on('error', (err) => {
    console.error('SERVICE_ERROR:' + (err.message || err));
    process.exit(1);
  });
  svc.uninstall();
} else if (isStart) {
  svc.on('start', () => {
    console.log('SERVICE_STARTED');
    setTimeout(() => process.exit(0), 500);
  });
  svc.on('error', (err) => {
    console.error('SERVICE_ERROR:' + (err.message || err));
    process.exit(1);
  });
  svc.start();
  setTimeout(() => {
    console.log('SERVICE_STARTED');
    process.exit(0);
  }, 2000);
} else if (isStop) {
  svc.on('stop', () => {
    console.log('SERVICE_STOPPED');
    setTimeout(() => process.exit(0), 500);
  });
  svc.on('error', (err) => {
    console.error('SERVICE_ERROR:' + (err.message || err));
    process.exit(1);
  });
  svc.stop();
  setTimeout(() => {
    console.log('SERVICE_STOPPED');
    process.exit(0), 2000;
  });
} else {
  svc.on('install', () => {
    console.log('SERVICE_INSTALLED');
    const cfg = loadConfig();
    updateFirewallRules(cfg.network?.httpPort || 8087, cfg.network?.httpsPort || 4447);
    svc.start();
    setTimeout(() => process.exit(0), 2000);
  });
  svc.on('alreadyinstalled', () => {
    console.log('SERVICE_ALREADY_INSTALLED');
    const cfg = loadConfig();
    updateFirewallRules(cfg.network?.httpPort || 8087, cfg.network?.httpsPort || 4447);
    svc.start();
    setTimeout(() => process.exit(0), 1000);
  });
  svc.on('error', (err) => {
    console.error('SERVICE_ERROR:' + (err.message || err));
    process.exit(1);
  });
  svc.install();
}

// Fallback timeout
setTimeout(() => {
  console.error('SERVICE_ERROR:Operation timed out');
  process.exit(1);
}, 30000);
