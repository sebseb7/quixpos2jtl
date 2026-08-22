/**
 * Service Manager — controls the REST API service lifecycle.
 *
 * Two modes:
 *  1. Embedded — forks server.js as a child process
 *  2. Windows Service — uses node-windows to install/manage via SCM
 */
const { fork, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const { loadConfig, saveConfig, PIPE_PATH, readState } = require('./config');

function getRealScriptPath(relPath) {
  const fullPath = path.join(__dirname, relPath);
  if (fullPath.includes('app.asar') && !fullPath.includes('app.asar.unpacked')) {
    return fullPath.replace('app.asar', 'app.asar.unpacked');
  }
  return fullPath;
}

const SERVICE_DISPLAY_NAME = 'QuixPOS2JTL';
const SERVICE_NAME = 'quixpos2jtl.exe'; // node-windows registers with .exe suffix
const SERVER_SCRIPT = getRealScriptPath(path.join('service', 'server.js'));
const INSTALL_SCRIPT = getRealScriptPath(path.join('service', 'install.js'));

let childProcess = null;
let statusListeners = [];

// ─── Embedded Mode ───────────────────────────────────────────

function startEmbedded() {
  if (childProcess) {
    return { success: false, error: 'Service is already running (embedded)' };
  }

  childProcess = fork(SERVER_SCRIPT, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  childProcess.on('message', (msg) => {
    notifyListeners(msg);
  });

  childProcess.stdout?.on('data', (data) => {
    notifyListeners({ type: 'log', message: data.toString().trim() });
  });

  childProcess.stderr?.on('data', (data) => {
    notifyListeners({ type: 'log', message: `[stderr] ${data.toString().trim()}` });
  });

  childProcess.on('exit', (code) => {
    childProcess = null;
    notifyListeners({ type: 'stopped', code });
  });

  return { success: true };
}

function stopEmbedded() {
  if (!childProcess) {
    return { success: false, error: 'Service is not running' };
  }
  childProcess.send('stop');
  // Force kill after 5 seconds
  const pid = childProcess.pid;
  setTimeout(() => {
    try { process.kill(pid); } catch { /* already dead */ }
  }, 5000);
  return { success: true };
}

function isEmbeddedRunning() {
  return childProcess !== null;
}

// ─── Windows Service Mode ────────────────────────────────────

/**
 * Run the install script elevated (triggers UAC prompt).
 * @param {string[]} args - extra arguments to pass
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function runElevated(args = []) {
  return new Promise((resolve) => {
    const nodePath = process.execPath; // path to node/electron executable
    // Use the system node if available, otherwise fall back
    const nodeExe = getSystemNode() || nodePath;
    const scriptArgs = [INSTALL_SCRIPT, ...args].map(a => `"${a}"`).join(' ');

    // Write a temp script that runs the install and writes output to a result file
    const fs = require('fs');
    const os = require('os');
    const resultFile = path.join(os.tmpdir(), `quixpos2jtl-svc-${Date.now()}.txt`);
    const batContent = `@echo off\r\n"${nodeExe}" ${scriptArgs} > "${resultFile}" 2>&1\r\n`;
    const batFile = path.join(os.tmpdir(), `quixpos2jtl-svc-${Date.now()}.cmd`);
    fs.writeFileSync(batFile, batContent, 'utf-8');

    console.log(`[ServiceManager] Running elevated: ${batFile}`);

    // Use PowerShell Start-Process with -Verb RunAs for UAC elevation
    const { exec } = require('child_process');
    const psCmd = `Start-Process -FilePath "${batFile}" -Verb RunAs -Wait -WindowStyle Hidden`;
    exec(`powershell -Command "${psCmd}"`, { timeout: 60000 }, (err) => {
      let output = '';
      try { output = fs.readFileSync(resultFile, 'utf-8'); } catch { /* no output */ }
      try { fs.unlinkSync(resultFile); } catch { /* cleanup */ }
      try { fs.unlinkSync(batFile); } catch { /* cleanup */ }

      console.log(`[ServiceManager] Elevated script output: ${output.trim()}`);

      if (err) {
        // User may have declined UAC
        if (err.killed || err.signal) {
          resolve({ success: false, error: 'Operation timed out' });
        } else {
          resolve({ success: false, error: 'Elevated access was denied or failed. Please accept the UAC prompt.' });
        }
        return;
      }

      if (output.includes('SERVICE_INSTALLED') || output.includes('SERVICE_ALREADY_INSTALLED')) {
        const config = loadConfig();
        config.service = { mode: 'windows-service' };
        saveConfig(config);
        resolve({ success: true });
      } else if (output.includes('SERVICE_UNINSTALLED')) {
        const config = loadConfig();
        config.service = { mode: 'embedded' };
        saveConfig(config);
        resolve({ success: true });
      } else if (output.includes('SERVICE_STARTED') || output.includes('SERVICE_STOPPED')) {
        resolve({ success: true });
      } else if (output.includes('SERVICE_ERROR:')) {
        const errorMsg = output.split('SERVICE_ERROR:')[1]?.trim() || 'Unknown error';
        resolve({ success: false, error: errorMsg });
      } else {
        resolve({ success: false, error: output.trim() || 'Unknown error — no output from install script' });
      }
    });
  });
}

/**
 * Try to find the system-installed Node.js (not the Electron-bundled one).
 */
function getSystemNode() {
  try {
    const { execSync: es } = require('child_process');
    const nodePath = es('where node', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
    if (nodePath && !nodePath.includes('electron')) return nodePath;
    return nodePath || null;
  } catch {
    return null;
  }
}

function installService() {
  console.log('[ServiceManager] Installing service (elevated)…');
  return runElevated([]);
}

function uninstallService() {
  console.log('[ServiceManager] Uninstalling service (elevated)…');
  return runElevated(['--uninstall']);
}

async function startWindowsService() {
  try {
    execSync(`net start "${SERVICE_NAME}"`, { stdio: 'ignore', shell: 'cmd.exe' });
    return { success: true };
  } catch (err) {
    console.log('[ServiceManager] Direct net start failed, attempting elevated start…');
    return runElevated(['--start']);
  }
}

async function stopWindowsService() {
  try {
    execSync(`net stop "${SERVICE_NAME}"`, { stdio: 'ignore', shell: 'cmd.exe' });
    return { success: true };
  } catch (err) {
    console.log('[ServiceManager] Direct net stop failed, attempting elevated stop…');
    return runElevated(['--stop']);
  }
}

function isServiceInstalled() {
  try {
    const out = execSync(`sc.exe query "${SERVICE_NAME}"`, { encoding: 'utf-8', shell: 'cmd.exe' });
    return !out.includes('1060'); // ERROR_SERVICE_DOES_NOT_EXIST
  } catch {
    return false;
  }
}

function getWindowsServiceStatus() {
  try {
    const out = execSync(`sc.exe query "${SERVICE_NAME}"`, { encoding: 'utf-8', shell: 'cmd.exe' });
    if (out.includes('RUNNING')) return 'running';
    if (out.includes('STOPPED')) return 'stopped';
    if (out.includes('PAUSED')) return 'paused';
    return 'unknown';
  } catch {
    return 'not-installed';
  }
}

// ─── Service IPC Query (Named Pipe with Live State Fallback) ───

/**
 * Send a request to the service over the Windows Named Pipe,
 * with automatic fallback to the live port published in state.json.
 */
function queryPipe(endpoint = '/api/status', method = 'GET', body = null, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = {};
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    // Try Named Pipe first
    const pipeReq = http.request(
      {
        socketPath: PIPE_PATH,
        path: endpoint,
        method,
        headers,
        timeout: 1000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data), transport: 'pipe' });
          } catch {
            resolve({ statusCode: res.statusCode, data, transport: 'pipe' });
          }
        });
      }
    );

    pipeReq.on('error', () => {
      // Fallback to reading the active HTTP port from state.json
      const state = readState();
      const cfg = loadConfig();
      const port = (state && state.httpPort) || (cfg.network && cfg.network.httpPort) || 8087;

      const httpReq = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: endpoint,
          method,
          headers,
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, data: JSON.parse(data), transport: `http:${port}` });
            } catch {
              resolve({ statusCode: res.statusCode, data, transport: `http:${port}` });
            }
          });
        }
      );

      httpReq.on('error', (err) => reject(err));
      httpReq.on('timeout', () => {
        httpReq.destroy();
        reject(new Error('Service query timed out'));
      });

      if (postData) httpReq.write(postData);
      httpReq.end();
    });

    pipeReq.on('timeout', () => {
      pipeReq.destroy();
      // Trigger error handler for fallback
    });

    if (postData) {
      pipeReq.write(postData);
    }
    pipeReq.end();
  });
}

// ─── Unified Status ──────────────────────────────────────────

function getStatus() {
  const config = loadConfig();
  const installed = isServiceInstalled();
  const mode = installed ? 'windows-service' : 'embedded';
  const runtimeState = readState();

  if (mode === 'windows-service') {
    const winStatus = getWindowsServiceStatus();
    return {
      mode: 'windows-service',
      installed: true,
      running: winStatus === 'running',
      serviceStatus: winStatus,
      runtime: runtimeState,
      pipe: PIPE_PATH,
    };
  }

  return {
    mode: 'embedded',
    installed: false,
    running: isEmbeddedRunning(),
    serviceStatus: isEmbeddedRunning() ? 'running' : 'stopped',
    runtime: runtimeState,
    pipe: PIPE_PATH,
  };
}

// ─── Listeners ───────────────────────────────────────────────

function onStatusChange(callback) {
  statusListeners.push(callback);
}

function removeStatusListener(callback) {
  statusListeners = statusListeners.filter((l) => l !== callback);
}

function notifyListeners(msg) {
  statusListeners.forEach((cb) => { try { cb(msg); } catch { /* ignore */ } });
}

// ─── Logs ────────────────────────────────────────────────────

const fs = require('fs');
const { CONFIG_DIR } = require('./config');
const SERVICE_LOG_FILE = path.join(CONFIG_DIR, 'logs', 'service.log');

async function getLogs({ since = 0, limit = 200, level = null } = {}) {
  try {
    let url = `/api/logs?since=${since}&limit=${limit}`;
    if (level && level !== 'ALL') url += `&level=${level}`;
    const res = await queryPipe(url, 2000);
    if (res && Array.isArray(res.logs)) {
      return res.logs;
    }
  } catch {
    // fallback to file
  }

  try {
    if (fs.existsSync(SERVICE_LOG_FILE)) {
      const content = fs.readFileSync(SERVICE_LOG_FILE, 'utf-8');
      const lines = content.trim().split(/\r?\n/).filter(Boolean);
      const entries = lines.map((line, idx) => {
        const match = line.match(/^\[(.*?)\]\s+\[(.*?)\]\s+(.*)$/);
        if (match) {
          return {
            id: idx + 1,
            timestamp: match[1],
            level: match[2],
            message: match[3],
          };
        }
        return {
          id: idx + 1,
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: line,
        };
      });
      let filtered = entries.filter((e) => e.id > since);
      if (level && level !== 'ALL') {
        filtered = filtered.filter((e) => e.level === level);
      }
      return filtered.slice(-limit);
    }
  } catch {
    // ignore
  }

  return [];
}

async function clearLogs() {
  try {
    await queryPipe('/api/logs', 2000);
  } catch {
    // ignore
  }
  try {
    if (fs.existsSync(SERVICE_LOG_FILE)) {
      fs.writeFileSync(SERVICE_LOG_FILE, '');
    }
  } catch {
    // ignore
  }
  return { success: true };
}

module.exports = {
  startEmbedded,
  stopEmbedded,
  isEmbeddedRunning,
  installService,
  uninstallService,
  startWindowsService,
  stopWindowsService,
  isServiceInstalled,
  getWindowsServiceStatus,
  getStatus,
  queryPipe,
  getLogs,
  clearLogs,
  onStatusChange,
  removeStatusListener,
};
