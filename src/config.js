/**
 * Shared configuration module.
 * Works in both Electron (main process) and standalone service contexts.
 * Config is stored at %APPDATA%/quixpos2jtl/config.json
 */
const fs = require('fs');
const path = require('path');

const APP_NAME = 'quixpos2jtl';

/**
 * Resolve the shared config directory.
 * Uses ProgramData on Windows (e.g. C:\ProgramData\quixpos2jtl) so both
 * standard user sessions (Electron app) and LocalSystem accounts (Windows Service)
 * access the exact same configuration and certificates.
 */
function getConfigDir() {
  if (process.env.QUIXPOS2JTL_CONFIG_DIR) {
    return process.env.QUIXPOS2JTL_CONFIG_DIR;
  }
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || process.env.ALLUSERSPROFILE || (process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'));
    return path.join(base, APP_NAME);
  }
  // Linux / macOS / POSIX
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return path.join('/etc', APP_NAME);
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config');
  return path.join(configHome, APP_NAME);
}

const CONFIG_DIR = getConfigDir();
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const STATE_PATH = path.join(CONFIG_DIR, 'state.json');
const CERTS_DIR = path.join(CONFIG_DIR, 'certs');

// Named pipe on Windows, Unix domain socket on POSIX
const PIPE_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\quixpos2jtl'
  : path.join(CONFIG_DIR, 'quixpos2jtl.sock');

const DEFAULTS = {
  db: {
    server: 'localhost',
    port: 1433,
    database: '',
    user: '',
    password: '',
    encrypt: false,
    trustServerCertificate: true,
  },
  network: {
    httpPort: 8087,
    httpsPort: 4447,
  },
  shop: {
    mandantId: 0,
    database: '',   // resolved from selected mandant's cDB
    steuerzoneId: 0,
    warenlagerId: 0,
    spracheId: 0,
    rootKategorieId: 0,
  },
  service: {
    mode: 'embedded', // 'embedded' | 'windows-service'
  },
};

/**
 * Ensure the config directory (and certs sub-dir) exist and migrate legacy user AppData if found.
 */
function ensureDirs() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  } catch {
    // ignore
  }

  // Migrate legacy config from %APPDATA%/quixpos2jtl if it exists and ProgramData config does not
  try {
    const legacyDir = path.join(process.env.APPDATA || '', APP_NAME);
    const legacyConfig = path.join(legacyDir, 'config.json');
    if (legacyDir !== CONFIG_DIR && fs.existsSync(legacyConfig) && !fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(legacyConfig, 'utf-8');
      fs.writeFileSync(CONFIG_PATH, data, 'utf-8');
    }
  } catch {
    // ignore migration errors
  }
}

/**
 * Load the persisted config, merged with defaults.
 */
function loadConfig() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const stored = JSON.parse(raw);
    return deepMerge(DEFAULTS, stored);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Save config to disk.
 */
function saveConfig(config) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Deep-merge source into target (non-mutating).
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Write runtime state to state.json
 */
function writeState(state) {
  ensureDirs();
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

/**
 * Read runtime state from state.json
 */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Clear state.json on shutdown
 */
function clearState() {
  try {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  } catch {
    // ignore
  }
}

module.exports = {
  APP_NAME,
  CONFIG_DIR,
  CONFIG_PATH,
  STATE_PATH,
  PIPE_PATH,
  CERTS_DIR,
  DEFAULTS,
  loadConfig,
  saveConfig,
  readState,
  writeState,
  clearState,
  ensureDirs,
};
