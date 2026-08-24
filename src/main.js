/**
 * Electron main process.
 * Creates a system-tray icon with context menu.
 * Manages the settings window and service lifecycle.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const config = require('./config');
const svcManager = require('./service-manager');
const cert = require('./service/cert');
const { logger } = require('./service/logger');
const { createPairingStore } = require('./service/jtl/pairing');
const { updateFirewallRules } = require('./service/firewall');

const pairingStore = createPairingStore();

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let tray = null;
let settingsWindow = null;

// ─── App Lifecycle ───────────────────────────────────────────

app.on('window-all-closed', (e) => {
  // Don't quit — we're a tray app
  e.preventDefault();
});

app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();

  // Ensure Windows Firewall rules match configured ports
  const cfg = config.loadConfig();
  updateFirewallRules(cfg.network?.httpPort || 8087, cfg.network?.httpsPort || 4447);

  // Auto-start embedded service if not installed as Windows service
  const status = svcManager.getStatus();
  if (status.mode === 'embedded') {
    svcManager.startEmbedded();
    updateTrayMenu();
  } else {
    updateTrayMenu();
  }
});

app.on('second-instance', () => {
  // If user tries to launch a second instance, show settings
  openSettings();
});

// ─── Tray ────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(getStatusIcon());
  tray.setToolTip('QuixPOS2JTL');
  tray.on('click', () => openSettings());
  updateTrayMenu();
}

// ─── Tray Icons ──────────────────────────────────────────────
// Green square  = embedded mode running
// Red square    = not running, no service installed
// Red ball      = service installed but stopped
// Green ball    = service running

function getStatusIcon() {
  const status = svcManager.getStatus();
  let icon;
  if (status.mode === 'embedded') {
    icon = status.running ? createShapeIcon('square', 'green') : createShapeIcon('square', 'red');
  } else {
    icon = status.running ? createShapeIcon('ball', 'green') : createShapeIcon('ball', 'red');
  }
  return icon.resize({ width: 16, height: 16 });
}

function createShapeIcon(shape, color) {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const colors = {
    green: [0x00, 0xC8, 0x64],
    red: [0xE0, 0x20, 0x20],
  };
  const [r, g, b] = colors[color] || colors.green;
  const center = (size - 1) / 2;
  const radius = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside;
      if (shape === 'ball') {
        const dx = x - center;
        const dy = y - center;
        // Anti-aliased circle edge
        const dist = Math.sqrt(dx * dx + dy * dy);
        inside = dist <= radius;
      } else {
        // Square with a small margin
        inside = x >= 1 && x < size - 1 && y >= 1 && y < size - 1;
      }
      const i = (y * size + x) * 4;
      canvas[i] = r;
      canvas[i + 1] = g;
      canvas[i + 2] = b;
      canvas[i + 3] = inside ? 0xFF : 0x00;
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayIcon() {
  if (tray && !tray.isDestroyed()) {
    tray.setImage(getStatusIcon());
  }
}

function updateTrayMenu() {
  const status = svcManager.getStatus();
  const isRunning = status.running;
  const isServiceMode = status.mode === 'windows-service';

  // Keep the icon in sync whenever the menu (and thus state) refreshes
  updateTrayIcon();

  const menuItems = [
    {
      label: `QuixPOS2JTL — ${isRunning ? '● Running' : '○ Stopped'}`,
      enabled: false,
    },
    {
      label: `Mode: ${isServiceMode ? 'Windows Service' : 'Embedded'}`,
      enabled: false,
    },
    { type: 'separator' },
  ];

  if (isServiceMode) {
    menuItems.push(
      { label: 'Start Service', click: () => { svcManager.startWindowsService(); updateTrayMenu(); }, enabled: !isRunning },
      { label: 'Stop Service', click: () => { svcManager.stopWindowsService(); updateTrayMenu(); }, enabled: isRunning },
      { type: 'separator' },
      { label: 'Uninstall Service', click: async () => { await svcManager.uninstallService(); updateTrayMenu(); } },
    );
  } else {
    menuItems.push(
      { label: 'Start', click: () => { svcManager.startEmbedded(); updateTrayMenu(); }, enabled: !isRunning },
      { label: 'Stop', click: () => { svcManager.stopEmbedded(); updateTrayMenu(); }, enabled: isRunning },
      { type: 'separator' },
      { label: 'Install as Windows Service', click: async () => { await svcManager.installService(); updateTrayMenu(); } },
    );
  }

  menuItems.push(
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        if (svcManager.isEmbeddedRunning()) {
          svcManager.stopEmbedded();
        }
        app.quit();
      },
    },
  );

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

// ─── Settings Window ─────────────────────────────────────────

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 820,
    height: 780,
    minWidth: 700,
    minHeight: 650,
    resizable: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: 'QuixPOS2JTL — Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── IPC Handlers ────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('get-config', () => config.loadConfig());

  ipcMain.handle('save-config', (_e, newConfig) => {
    config.saveConfig(newConfig);
    updateFirewallRules(newConfig.network?.httpPort || 8087, newConfig.network?.httpsPort || 4447);
    return { success: true };
  });

  ipcMain.handle('test-connection', async (_e, dbConfig) => {
    try {
      const sqlConfig = {
        server: dbConfig.server,
        port: parseInt(dbConfig.port, 10) || 1433,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        options: {
          encrypt: !!dbConfig.encrypt,
          trustServerCertificate: !!dbConfig.trustServerCertificate,
        },
        connectionTimeout: 10000,
        requestTimeout: 10000,
      };
      const pool = await sql.connect(sqlConfig);
      const result = await pool.request().query('SELECT GETDATE() AS currentDate');
      await pool.close();
      return { success: true, serverTime: result.recordset[0].currentDate };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('list-databases', async (_e, dbConfig) => {
    try {
      const sqlConfig = {
        server: dbConfig.server,
        port: parseInt(dbConfig.port, 10) || 1433,
        user: dbConfig.user,
        password: dbConfig.password,
        options: {
          encrypt: !!dbConfig.encrypt,
          trustServerCertificate: !!dbConfig.trustServerCertificate,
        },
        connectionTimeout: 10000,
        requestTimeout: 10000,
      };
      const pool = await sql.connect(sqlConfig);
      const result = await pool.request().query(
        `SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name`
      );
      await pool.close();
      return { success: true, databases: result.recordset.map((r) => r.name) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('list-mandants', async (_e, dbConfig) => {
    try {
      const sqlConfig = {
        server: dbConfig.server,
        port: parseInt(dbConfig.port, 10) || 1433,
        user: dbConfig.user,
        password: dbConfig.password,
        options: {
          encrypt: !!dbConfig.encrypt,
          trustServerCertificate: !!dbConfig.trustServerCertificate,
        },
        connectionTimeout: 10000,
        requestTimeout: 10000,
      };
      const pool = await sql.connect(sqlConfig);
      // tMandant always lives in eazybusiness
      const result = await pool.request().query(
        `SELECT kMandant, cName, cDB FROM [eazybusiness].[dbo].[tMandant] ORDER BY kMandant`
      );
      await pool.close();
      return { success: true, mandants: result.recordset };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('list-shop-options', async (_e, dbConfig) => {
    try {
      const dbName = String(dbConfig.database || '').replace(/]/g, ']]');
      const sqlConfig = {
        server: dbConfig.server,
        port: parseInt(dbConfig.port, 10) || 1433,
        user: dbConfig.user,
        password: dbConfig.password,
        options: {
          encrypt: !!dbConfig.encrypt,
          trustServerCertificate: !!dbConfig.trustServerCertificate,
        },
        connectionTimeout: 10000,
        requestTimeout: 10000,
      };
      const pool = await sql.connect(sqlConfig);
      const request = pool.request();
      const tz = await request.query(
        `SELECT kSteuerzone, cName FROM [${dbName}].[dbo].[tSteuerzone] ORDER BY kSteuerzone`);
      const wl = await request.query(
        `SELECT kWarenLager, cName FROM [${dbName}].[dbo].[tWarenLager] ORDER BY kWarenLager`);
      const sp = await request.query(
        `SELECT kSprache, cNameEng FROM [${dbName}].[dbo].[tSpracheUsed] ORDER BY kSprache`);
      const kat = await request.query(
        `SELECT kKategorie, cName FROM [${dbName}].[dbo].[tKategorieSprache] ORDER BY kKategorie`);
      await pool.close();
      return {
        success: true,
        steuerzonen: tz.recordset,
        warenlager: wl.recordset,
        sprachen: sp.recordset,
        kategorien: kat.recordset,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('generate-cert', async () => {
    try {
      logger.info('Generating self-signed TLS certificate…');
      const result = await cert.generateCert();
      logger.success('TLS certificate generated successfully');
      return { success: true, publicKey: result.cert };
    } catch (err) {
      logger.error(`Failed to generate TLS certificate: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-cert-info', () => {
    const pem = cert.getPublicKeyPem();
    return { exists: cert.certExists(), publicKey: pem };
  });

  ipcMain.handle('export-cert', async (_e, destPath) => {
    try {
      const pem = cert.getPublicKeyPem();
      if (!pem) return { success: false, error: 'No certificate generated yet' };
      fs.writeFileSync(destPath, pem, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('show-save-dialog', async (_e, options) => {
    const result = await dialog.showSaveDialog(settingsWindow, options);
    return result;
  });

  ipcMain.handle('get-service-status', () => svcManager.getStatus());

  ipcMain.handle('get-logs', async (_e, filter) => {
    try {
      const logs = await svcManager.getLogs(filter || {});
      return { success: true, logs };
    } catch (err) {
      return { success: false, error: err.message, logs: [] };
    }
  });

  ipcMain.handle('clear-logs', async () => {
    return await svcManager.clearLogs();
  });

  // Pairing & Devices
  ipcMain.handle('get-pairing-state', () => {
    try {
      return { success: true, ...pairingStore.getPairingState() };
    } catch (err) {
      return { success: false, error: err.message, pairingCodes: [], pairedDevices: [] };
    }
  });

  ipcMain.handle('generate-pairing-code', (_e, name) => {
    try {
      const codeEntry = pairingStore.generatePairingCode(name || 'JTL-POS');
      return { success: true, ...codeEntry };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('revoke-pairing-code', (_e, code) => {
    try {
      pairingStore.revokePairingCode(code);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('remove-paired-device', (_e, token) => {
    try {
      pairingStore.removePairedDevice(token);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ping-pipe', async () => {
    try {
      const res = await svcManager.queryPipe('/api/status', 'GET', null, 1500);
      return { success: true, info: res.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-service', async () => {
    const status = svcManager.getStatus();
    let result;
    if (status.mode === 'windows-service') {
      result = await svcManager.startWindowsService();
    } else {
      result = svcManager.startEmbedded();
    }
    updateTrayMenu();
    return result;
  });

  ipcMain.handle('stop-service', async () => {
    const status = svcManager.getStatus();
    let result;
    if (status.mode === 'windows-service') {
      result = await svcManager.stopWindowsService();
    } else {
      result = svcManager.stopEmbedded();
    }
    updateTrayMenu();
    return result;
  });

  ipcMain.handle('install-service', async () => {
    // Stop embedded first
    if (svcManager.isEmbeddedRunning()) {
      svcManager.stopEmbedded();
    }
    const result = await svcManager.installService();
    updateTrayMenu();
    return result;
  });

  ipcMain.handle('uninstall-service', async () => {
    const result = await svcManager.uninstallService();
    // Start embedded after uninstall
    svcManager.startEmbedded();
    updateTrayMenu();
    return result;
  });
}
