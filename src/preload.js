/**
 * Preload script — exposes a safe IPC bridge to the renderer (settings window).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Database
  testConnection: (dbConfig) => ipcRenderer.invoke('test-connection', dbConfig),
  listDatabases: (dbConfig) => ipcRenderer.invoke('list-databases', dbConfig),

  // Shop (JTL-Wawi)
  listMandants: (dbConfig) => ipcRenderer.invoke('list-mandants', dbConfig),
  listShops: (dbConfig) => ipcRenderer.invoke('list-shops', dbConfig),

  // Certificate
  generateCert: (options) => ipcRenderer.invoke('generate-cert', options),
  getCertInfo: () => ipcRenderer.invoke('get-cert-info'),
  getLocalIps: () => ipcRenderer.invoke('get-local-ips'),
  exportCert: (destPath) => ipcRenderer.invoke('export-cert', destPath),

  // Service
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  pingPipe: () => ipcRenderer.invoke('ping-pipe'),
  startService: () => ipcRenderer.invoke('start-service'),
  stopService: () => ipcRenderer.invoke('stop-service'),
  installService: () => ipcRenderer.invoke('install-service'),
  uninstallService: () => ipcRenderer.invoke('uninstall-service'),

  // Logs
  getLogs: (filter) => ipcRenderer.invoke('get-logs', filter),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  // Pairing & Devices
  getPairingState: () => ipcRenderer.invoke('get-pairing-state'),
  generatePairingCode: (name) => ipcRenderer.invoke('generate-pairing-code', name),
  revokePairingCode: (code) => ipcRenderer.invoke('revoke-pairing-code', code),
  removePairedDevice: (token) => ipcRenderer.invoke('remove-paired-device', token),

  // Dialog
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
});
