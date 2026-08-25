/**
 * Interactive Terminal / CLI Settings Editor and CLI Configuration Handler for QuixPOS2JTL.
 * Supports interactive menu-driven editing and direct command-line flags for:
 *  - MSSQL Database Settings
 *  - JTL-Wawi Shop Settings
 *  - POS Server Network / Port Settings
 *  - TLS Certificate Generation & Export
 *  - JTL-POS Pairing PIN & Paired Devices
 */
const readline = require('readline');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, CONFIG_PATH } = require('../config');
const cert = require('./cert');
const { readCertMetadata } = require('./jtl/cert-meta');
const { createPairingStore } = require('./jtl/pairing');

const pairingStore = createPairingStore();

// ANSI Colors for clean terminal display
const C = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

function askQuestion(rl, query, defaultVal = '') {
  return new Promise((resolve) => {
    const promptText = defaultVal !== '' && defaultVal !== undefined
      ? `${query} ${C.gray}[default: ${defaultVal}]${C.reset}: `
      : `${query}: `;
    rl.question(promptText, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || (defaultVal !== undefined ? defaultVal : ''));
    });
  });
}

function askSecret(rl, query, defaultVal = '') {
  return new Promise((resolve) => {
    const promptText = defaultVal !== ''
      ? `${query} ${C.gray}[default: ${'•'.repeat(Math.min(defaultVal.length, 8))}]${C.reset}: `
      : `${query}: `;
    process.stdout.write(promptText);

    // Disable raw echo if terminal supports it
    if (process.stdin.isTTY) {
      let buffer = '';
      const onData = (char) => {
        char = char.toString();
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            const trimmed = buffer.trim();
            resolve(trimmed || defaultVal);
            break;
          case '\u0003': // Ctrl+C
            process.exit(0);
            break;
          case '\u0008': // Backspace
          case '\x7f':
            if (buffer.length > 0) {
              buffer = buffer.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            buffer += char;
            process.stdout.write('*');
            break;
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question('', (answer) => {
        const trimmed = answer.trim();
        resolve(trimmed || defaultVal);
      });
    }
  });
}

/**
 * Test DB connection with provided or loaded config.
 */
async function testDbConnection(dbCfg) {
  try {
    const sqlConfig = {
      server: dbCfg.server || 'localhost',
      port: parseInt(dbCfg.port, 10) || 1433,
      database: dbCfg.database || undefined,
      user: dbCfg.user || '',
      password: dbCfg.password || '',
      options: {
        encrypt: !!dbCfg.encrypt,
        trustServerCertificate: dbCfg.trustServerCertificate !== false,
      },
      connectionTimeout: 8000,
      requestTimeout: 8000,
    };
    const started = Date.now();
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query('SELECT GETDATE() AS currentDate');
    await pool.close();
    const duration = Date.now() - started;
    return {
      success: true,
      serverTime: result.recordset[0]?.currentDate,
      durationMs: duration,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * List databases on MSSQL server.
 */
async function queryDatabases(dbCfg) {
  try {
    const sqlConfig = {
      server: dbCfg.server || 'localhost',
      port: parseInt(dbCfg.port, 10) || 1433,
      user: dbCfg.user || '',
      password: dbCfg.password || '',
      options: {
        encrypt: !!dbCfg.encrypt,
        trustServerCertificate: dbCfg.trustServerCertificate !== false,
      },
      connectionTimeout: 8000,
      requestTimeout: 8000,
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
}

/**
 * Query mandants and shop options from JTL database.
 */
async function queryShopOptions(dbCfg) {
  try {
    const dbName = String(dbCfg.database || '').replace(/]/g, ']]');
    const sqlConfig = {
      server: dbCfg.server || 'localhost',
      port: parseInt(dbCfg.port, 10) || 1433,
      user: dbCfg.user || '',
      password: dbCfg.password || '',
      options: {
        encrypt: !!dbCfg.encrypt,
        trustServerCertificate: dbCfg.trustServerCertificate !== false,
      },
      connectionTimeout: 8000,
      requestTimeout: 8000,
    };
    const pool = await sql.connect(sqlConfig);
    const req = pool.request();

    let mandants = [];
    try {
      const mandRes = await req.query(`SELECT kMandant, cName, cDB FROM [eazybusiness].[dbo].[tMandant] ORDER BY kMandant`);
      mandants = mandRes.recordset;
    } catch {
      // eazybusiness might not exist
    }

    let steuerzonen = [];
    let warenlager = [];
    let sprachen = [];
    let kategorien = [];

    if (dbCfg.database) {
      try {
        const tz = await req.query(`SELECT kSteuerzone, cName FROM [${dbName}].[dbo].[tSteuerzone] ORDER BY kSteuerzone`);
        steuerzonen = tz.recordset;
      } catch { /* ignore */ }
      try {
        const wl = await req.query(`SELECT kWarenLager, cName FROM [${dbName}].[dbo].[tWarenLager] ORDER BY kWarenLager`);
        warenlager = wl.recordset;
      } catch { /* ignore */ }
      try {
        const sp = await req.query(`SELECT kSprache, cNameEng FROM [${dbName}].[dbo].[tSpracheUsed] ORDER BY kSprache`);
        sprachen = sp.recordset;
      } catch { /* ignore */ }
      try {
        const kat = await req.query(`SELECT kKategorie, cName FROM [${dbName}].[dbo].[tKategorieSprache] ORDER BY kKategorie`);
        kategorien = kat.recordset;
      } catch { /* ignore */ }
    }

    await pool.close();
    return {
      success: true,
      mandants,
      steuerzonen,
      warenlager,
      sprachen,
      kategorien,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Submenu: Database Settings ──────────────────────────────────────
async function editDatabaseSettings(rl, config) {
  while (true) {
    console.log(`\n${C.cyan}${C.bright}=== MSSQL Database Connection Settings ===${C.reset}`);
    console.log(`[1] Server Host      : ${C.green}${config.db.server || 'localhost'}${C.reset}`);
    console.log(`[2] Port             : ${C.green}${config.db.port || 1433}${C.reset}`);
    console.log(`[3] Database Name    : ${C.green}${config.db.database || '(none)'}${C.reset}`);
    console.log(`[4] Username         : ${C.green}${config.db.user || '(none)'}${C.reset}`);
    console.log(`[5] Password         : ${C.green}${config.db.password ? '••••••••' : '(none)'}${C.reset}`);
    console.log(`[6] Encrypt          : ${C.green}${config.db.encrypt ? 'Yes (Enabled)' : 'No (Disabled)'}${C.reset}`);
    console.log(`[7] Trust Certificate: ${C.green}${config.db.trustServerCertificate !== false ? 'Yes (Trusted)' : 'No'}${C.reset}`);
    console.log(`[8] Select Database from Server List`);
    console.log(`[9] Test Connection Now`);
    console.log(`[0] Back to Main Menu`);

    const choice = await askQuestion(rl, '\nSelect option');
    if (choice === '0') break;

    switch (choice) {
      case '1': {
        const val = await askQuestion(rl, 'Enter MSSQL Server Host/IP', config.db.server || 'localhost');
        config.db.server = val;
        break;
      }
      case '2': {
        const val = await askQuestion(rl, 'Enter MSSQL Port', String(config.db.port || 1433));
        config.db.port = parseInt(val, 10) || 1433;
        break;
      }
      case '3': {
        const val = await askQuestion(rl, 'Enter Database Name', config.db.database || 'eazybusiness');
        config.db.database = val;
        break;
      }
      case '4': {
        const val = await askQuestion(rl, 'Enter MSSQL Username', config.db.user || 'sa');
        config.db.user = val;
        break;
      }
      case '5': {
        const val = await askSecret(rl, 'Enter MSSQL Password', config.db.password || '');
        config.db.password = val;
        break;
      }
      case '6': {
        const val = await askQuestion(rl, 'Encrypt connection? (y/n)', config.db.encrypt ? 'y' : 'n');
        config.db.encrypt = val.toLowerCase().startsWith('y');
        break;
      }
      case '7': {
        const val = await askQuestion(rl, 'Trust server certificate? (y/n)', config.db.trustServerCertificate !== false ? 'y' : 'n');
        config.db.trustServerCertificate = val.toLowerCase().startsWith('y');
        break;
      }
      case '8': {
        console.log(`\n${C.gray}Fetching database list from ${config.db.server}:${config.db.port}...${C.reset}`);
        const res = await queryDatabases(config.db);
        if (res.success && res.databases.length) {
          console.log(`\n${C.green}Found ${res.databases.length} database(s):${C.reset}`);
          res.databases.forEach((db, i) => {
            const cur = db === config.db.database ? ` ${C.yellow}(current)${C.reset}` : '';
            console.log(` [${i + 1}] ${db}${cur}`);
          });
          const pick = await askQuestion(rl, 'Choose number to select database (or press Enter to cancel)');
          const idx = parseInt(pick, 10) - 1;
          if (idx >= 0 && idx < res.databases.length) {
            config.db.database = res.databases[idx];
            console.log(`${C.green}✓ Selected database: ${config.db.database}${C.reset}`);
          }
        } else {
          console.log(`${C.red}✗ Could not fetch databases: ${res.error || 'No databases found'}${C.reset}`);
        }
        break;
      }
      case '9': {
        console.log(`\n${C.gray}Testing connection to ${config.db.server}:${config.db.port}/${config.db.database}...${C.reset}`);
        const res = await testDbConnection(config.db);
        if (res.success) {
          console.log(`${C.green}✓ MSSQL Connection SUCCESSFUL!${C.reset} (Server time: ${res.serverTime}, Latency: ${res.durationMs}ms)`);
        } else {
          console.log(`${C.red}✗ Connection FAILED:${C.reset} ${res.error}`);
        }
        break;
      }
    }
  }
}

// ─── Submenu: Shop Settings ──────────────────────────────────────────
async function editShopSettings(rl, config) {
  while (true) {
    console.log(`\n${C.cyan}${C.bright}=== JTL-Wawi Shop Settings ===${C.reset}`);
    console.log(`[1] Mandant ID     : ${C.green}${config.shop?.mandantId ?? 0}${C.reset}`);
    console.log(`[2] Shop Database  : ${C.green}${config.shop?.database || config.db?.database || '(auto)'}${C.reset}`);
    console.log(`[3] Steuerzone ID  : ${C.green}${config.shop?.steuerzoneId ?? 0}${C.reset}`);
    console.log(`[4] Warenlager ID  : ${C.green}${config.shop?.warenlagerId ?? 0}${C.reset}`);
    console.log(`[5] Sprache ID     : ${C.green}${config.shop?.spracheId ?? 0}${C.reset}`);
    console.log(`[6] Root-Kat ID    : ${C.green}${config.shop?.rootKategorieId ?? 0}${C.reset}`);
    console.log(`[7] Auto-Select from JTL-Wawi Database (Live Query)`);
    console.log(`[0] Back to Main Menu`);

    const choice = await askQuestion(rl, '\nSelect option');
    if (choice === '0') break;

    config.shop = config.shop || {};

    switch (choice) {
      case '1': {
        const val = await askQuestion(rl, 'Enter Mandant ID (kMandant)', String(config.shop.mandantId ?? 0));
        config.shop.mandantId = parseInt(val, 10) || 0;
        break;
      }
      case '2': {
        const val = await askQuestion(rl, 'Enter Mandant Database Name', config.shop.database || config.db.database || 'eazybusiness');
        config.shop.database = val;
        break;
      }
      case '3': {
        const val = await askQuestion(rl, 'Enter Steuerzone ID (kSteuerzone)', String(config.shop.steuerzoneId ?? 0));
        config.shop.steuerzoneId = parseInt(val, 10) || 0;
        break;
      }
      case '4': {
        const val = await askQuestion(rl, 'Enter Warenlager ID (kWarenLager)', String(config.shop.warenlagerId ?? 0));
        config.shop.warenlagerId = parseInt(val, 10) || 0;
        break;
      }
      case '5': {
        const val = await askQuestion(rl, 'Enter Sprache ID (kSprache)', String(config.shop.spracheId ?? 0));
        config.shop.spracheId = parseInt(val, 10) || 0;
        break;
      }
      case '6': {
        const val = await askQuestion(rl, 'Enter Root-Kategorie ID (kKategorie, 0 for all)', String(config.shop.rootKategorieId ?? 0));
        config.shop.rootKategorieId = parseInt(val, 10) || 0;
        break;
      }
      case '7': {
        console.log(`\n${C.gray}Querying shop options from ${config.db.server}/${config.db.database}...${C.reset}`);
        const res = await queryShopOptions(config.db);
        if (!res.success) {
          console.log(`${C.red}✗ Failed to query shop options: ${res.error}${C.reset}`);
          break;
        }

        // Mandants
        if (res.mandants?.length) {
          console.log(`\n${C.yellow}Available Mandants:${C.reset}`);
          res.mandants.forEach((m, i) => console.log(` [${i + 1}] ID: ${m.kMandant} - "${m.cName}" (DB: ${m.cDB})`));
          const p = await askQuestion(rl, 'Select Mandant number (or Enter to keep)');
          const idx = parseInt(p, 10) - 1;
          if (idx >= 0 && idx < res.mandants.length) {
            config.shop.mandantId = res.mandants[idx].kMandant;
            config.shop.database = res.mandants[idx].cDB;
            config.shop.mandantName = res.mandants[idx].cName;
            console.log(`${C.green}✓ Set mandant to: ${res.mandants[idx].cName}${C.reset}`);
          }
        }

        // Steuerzonen
        if (res.steuerzonen?.length) {
          console.log(`\n${C.yellow}Available Steuerzonen:${C.reset}`);
          res.steuerzonen.forEach((tz, i) => console.log(` [${i + 1}] ID: ${tz.kSteuerzone} - "${tz.cName}"`));
          const p = await askQuestion(rl, 'Select Steuerzone number (or Enter to keep)');
          const idx = parseInt(p, 10) - 1;
          if (idx >= 0 && idx < res.steuerzonen.length) {
            config.shop.steuerzoneId = res.steuerzonen[idx].kSteuerzone;
            console.log(`${C.green}✓ Set Steuerzone ID: ${config.shop.steuerzoneId}${C.reset}`);
          }
        }

        // Warenlager
        if (res.warenlager?.length) {
          console.log(`\n${C.yellow}Available Warenlager:${C.reset}`);
          res.warenlager.forEach((wl, i) => console.log(` [${i + 1}] ID: ${wl.kWarenLager} - "${wl.cName}"`));
          const p = await askQuestion(rl, 'Select Warenlager number (or Enter to keep)');
          const idx = parseInt(p, 10) - 1;
          if (idx >= 0 && idx < res.warenlager.length) {
            config.shop.warenlagerId = res.warenlager[idx].kWarenLager;
            console.log(`${C.green}✓ Set Warenlager ID: ${config.shop.warenlagerId}${C.reset}`);
          }
        }

        // Sprachen
        if (res.sprachen?.length) {
          console.log(`\n${C.yellow}Available Sprachen:${C.reset}`);
          res.sprachen.forEach((sp, i) => console.log(` [${i + 1}] ID: ${sp.kSprache} - "${sp.cNameEng}"`));
          const p = await askQuestion(rl, 'Select Sprache number (or Enter to keep)');
          const idx = parseInt(p, 10) - 1;
          if (idx >= 0 && idx < res.sprachen.length) {
            config.shop.spracheId = res.sprachen[idx].kSprache;
            console.log(`${C.green}✓ Set Sprache ID: ${config.shop.spracheId}${C.reset}`);
          }
        }

        break;
      }
    }
  }
}

// ─── Submenu: Network & POS Server Settings ──────────────────────────
async function editNetworkSettings(rl, config) {
  while (true) {
    console.log(`\n${C.cyan}${C.bright}=== Network & POS Server Settings ===${C.reset}`);
    console.log(`[1] HTTP Port         : ${C.green}${config.network?.httpPort || 8087}${C.reset}`);
    console.log(`[2] HTTPS Port        : ${C.green}${config.network?.httpsPort || 4447}${C.reset}`);
    console.log(`[3] Auth Token        : ${C.green}${config.auth?.authToken || '(auto/dynamic pairing)'}${C.reset}`);
    console.log(`[4] Verbose Req Body  : ${C.green}${config.logging?.logBody ? 'Enabled' : 'Disabled'}${C.reset}`);
    console.log(`[5] Verbose Resp Text : ${C.green}${config.logging?.logResponse ? 'Enabled' : 'Disabled'}${C.reset}`);
    console.log(`[0] Back to Main Menu`);

    const choice = await askQuestion(rl, '\nSelect option');
    if (choice === '0') break;

    config.network = config.network || {};
    config.logging = config.logging || {};
    config.auth = config.auth || {};

    switch (choice) {
      case '1': {
        const val = await askQuestion(rl, 'Enter HTTP Port', String(config.network.httpPort || 8087));
        config.network.httpPort = parseInt(val, 10) || 8087;
        break;
      }
      case '2': {
        const val = await askQuestion(rl, 'Enter HTTPS Port', String(config.network.httpsPort || 4447));
        config.network.httpsPort = parseInt(val, 10) || 4447;
        break;
      }
      case '3': {
        const val = await askQuestion(rl, 'Enter Auth Token (leave blank for dynamic)', config.auth.authToken || '');
        config.auth.authToken = val;
        break;
      }
      case '4': {
        const val = await askQuestion(rl, 'Log request bodies? (y/n)', config.logging.logBody ? 'y' : 'n');
        config.logging.logBody = val.toLowerCase().startsWith('y');
        break;
      }
      case '5': {
        const val = await askQuestion(rl, 'Log response bodies? (y/n)', config.logging.logResponse ? 'y' : 'n');
        config.logging.logResponse = val.toLowerCase().startsWith('y');
        break;
      }
    }
  }
}

// ─── Submenu: Certificate Settings ───────────────────────────────────
async function editCertificateSettings(rl) {
  while (true) {
    const pem = cert.getPublicKeyPem();
    const exists = cert.certExists();
    const meta = pem ? readCertMetadata(pem) : null;

    console.log(`\n${C.cyan}${C.bright}=== TLS Certificate Management ===${C.reset}`);
    console.log(`Status         : ${exists ? `${C.green}✓ Certificate Available${C.reset}` : `${C.yellow}⚠ No certificate generated${C.reset}`}`);
    if (meta) {
      console.log(`Fingerprint    : ${C.green}${meta.serverFingerprint || 'N/A'}${C.reset}`);
      console.log(`Serial Number  : ${C.green}${meta.certificateSerialNumber || 'N/A'}${C.reset}`);
    }
    console.log(`[1] Generate Fresh Self-Signed Certificate`);
    console.log(`[2] Export Public Key (.crt file)`);
    console.log(`[3] Display Public Key (PEM) on screen`);
    console.log(`[0] Back to Main Menu`);

    const choice = await askQuestion(rl, '\nSelect option');
    if (choice === '0') break;

    switch (choice) {
      case '1': {
        const confirm = await askQuestion(rl, 'Generate new certificate? This will overwrite the current one (y/n)', 'n');
        if (confirm.toLowerCase().startsWith('y')) {
          console.log(`${C.gray}Generating 2048-bit RSA self-signed certificate...${C.reset}`);
          const res = await cert.generateCert();
          const newMeta = readCertMetadata(res.cert);
          console.log(`${C.green}✓ Certificate generated successfully!${C.reset}`);
          console.log(`Fingerprint: ${newMeta.serverFingerprint}`);
        }
        break;
      }
      case '2': {
        if (!pem) {
          console.log(`${C.red}✗ No certificate found. Please generate one first.${C.reset}`);
          break;
        }
        const defaultPath = path.join(process.cwd(), 'quixpos2jtl-server.crt');
        const dest = await askQuestion(rl, 'Enter file path to export certificate to', defaultPath);
        try {
          fs.writeFileSync(dest, pem, 'utf-8');
          console.log(`${C.green}✓ Certificate exported to: ${dest}${C.reset}`);
        } catch (err) {
          console.log(`${C.red}✗ Export failed: ${err.message}${C.reset}`);
        }
        break;
      }
      case '3': {
        if (!pem) {
          console.log(`${C.red}✗ No certificate found.${C.reset}`);
        } else {
          console.log(`\n${C.yellow}--- Public Key PEM ---${C.reset}\n${pem}\n${C.yellow}----------------------${C.reset}`);
        }
        break;
      }
    }
  }
}

// ─── Submenu: Pairing & POS Devices ──────────────────────────────────
async function editPairingSettings(rl) {
  while (true) {
    const state = pairingStore.getPairingState();
    const activePin = state.pairingCodes[0];
    const devices = state.pairedDevices || [];

    console.log(`\n${C.cyan}${C.bright}=== JTL-POS Register Pairing & Devices ===${C.reset}`);
    console.log(`Active Pairing PIN : ${activePin ? `${C.green}${C.bright}${activePin.code}${C.reset} (created: ${activePin.createdAt})` : `${C.gray}None${C.reset}`}`);
    console.log(`Paired POS Devices : ${C.green}${devices.length} device(s)${C.reset}`);

    console.log(`\n[1] Generate New Random 6-Digit PIN`);
    console.log(`[2] Set Custom Pairing PIN`);
    console.log(`[3] Revoke Active PIN`);
    console.log(`[4] List All Paired Devices`);
    console.log(`[5] Remove / Revoke a Paired Device`);
    console.log(`[0] Back to Main Menu`);

    const choice = await askQuestion(rl, '\nSelect option');
    if (choice === '0') break;

    switch (choice) {
      case '1': {
        const name = await askQuestion(rl, 'Enter device / register label', 'JTL-POS');
        const entry = pairingStore.generatePairingCode(name);
        console.log(`${C.green}✓ Generated Pairing PIN: ${C.bright}${entry.code}${C.reset} for "${entry.name}"`);
        break;
      }
      case '2': {
        const pin = await askQuestion(rl, 'Enter custom 4 to 8 digit PIN');
        if (pin) {
          const name = await askQuestion(rl, 'Enter device label', 'JTL-POS');
          pairingStore.setPairingCode(pin, name);
          console.log(`${C.green}✓ Set Pairing PIN: ${C.bright}${pin}${C.reset}`);
        }
        break;
      }
      case '3': {
        pairingStore.revokePairingCode();
        console.log(`${C.yellow}✓ Active pairing PIN revoked.${C.reset}`);
        break;
      }
      case '4': {
        if (!devices.length) {
          console.log(`${C.gray}No devices have been paired yet.${C.reset}`);
        } else {
          console.log(`\n${C.yellow}Paired POS Devices (${devices.length}):${C.reset}`);
          devices.forEach((d, i) => {
            console.log(` [${i + 1}] Name: ${C.bright}${d.name}${C.reset} | Token: ${d.token.slice(0, 10)}... | IP: ${d.clientIp || 'N/A'} | Paired: ${d.pairedAt || 'N/A'}`);
          });
        }
        break;
      }
      case '5': {
        if (!devices.length) {
          console.log(`${C.gray}No devices to remove.${C.reset}`);
          break;
        }
        devices.forEach((d, i) => {
          console.log(` [${i + 1}] ${d.name} (${d.token.slice(0, 8)}...)`);
        });
        const pick = await askQuestion(rl, 'Enter number of device to remove (or Enter to cancel)');
        const idx = parseInt(pick, 10) - 1;
        if (idx >= 0 && idx < devices.length) {
          pairingStore.removePairedDevice(devices[idx].token);
          console.log(`${C.green}✓ Device removed.${C.reset}`);
        }
        break;
      }
    }
  }
}

// ─── Main Interactive CLI Menu ───────────────────────────────────────
async function runCliEditor() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n${C.cyan}${C.bright}============================================================`);
  console.log(`              QuixPOS2JTL CLI Settings Editor`);
  console.log(`============================================================${C.reset}`);

  let config = loadConfig();

  while (true) {
    console.log(`\n${C.cyan}${C.bright}=== Main Menu ===${C.reset}`);
    console.log(`[1] Database Connection (${config.db.server}:${config.db.port || 1433}/${config.db.database || 'none'})`);
    console.log(`[2] JTL-Wawi Shop Settings (Mandant: ${config.shop?.mandantId ?? 0}, Shop DB: ${config.shop?.database || config.db.database || 'none'})`);
    console.log(`[3] Network & Ports (HTTP :${config.network?.httpPort || 8087}, HTTPS :${config.network?.httpsPort || 4447})`);
    console.log(`[4] TLS Certificate Settings`);
    console.log(`[5] JTL-POS Pairing PIN & Paired Devices`);
    console.log(`[6] Test Database Connection`);
    console.log(`[7] View Full Configuration Summary`);
    console.log(`[8] Save Configuration & Start Service`);
    console.log(`[9] Save Configuration & Exit`);
    console.log(`[0] Exit Without Saving`);

    const choice = await askQuestion(rl, '\nSelect option [0-9]');

    if (choice === '0') {
      console.log(`${C.yellow}Exiting without saving changes.${C.reset}`);
      rl.close();
      process.exit(0);
    }

    if (choice === '9') {
      saveConfig(config);
      console.log(`\n${C.green}✓ Configuration saved successfully to ${CONFIG_PATH}!${C.reset}\n`);
      rl.close();
      process.exit(0);
    }

    if (choice === '8') {
      saveConfig(config);
      console.log(`\n${C.green}✓ Configuration saved! Starting REST service...${C.reset}\n`);
      rl.close();
      return true; // proceed to start server
    }

    switch (choice) {
      case '1':
        await editDatabaseSettings(rl, config);
        break;
      case '2':
        await editShopSettings(rl, config);
        break;
      case '3':
        await editNetworkSettings(rl, config);
        break;
      case '4':
        await editCertificateSettings(rl);
        break;
      case '5':
        await editPairingSettings(rl);
        break;
      case '6': {
        console.log(`\n${C.gray}Testing connection to ${config.db.server}:${config.db.port || 1433}/${config.db.database}...${C.reset}`);
        const res = await testDbConnection(config.db);
        if (res.success) {
          console.log(`${C.green}✓ Database is REACHABLE & HEALTHY!${C.reset} (Latency: ${res.durationMs}ms, Server time: ${res.serverTime})`);
        } else {
          console.log(`${C.red}✗ Database connection FAILED:${C.reset} ${res.error}`);
        }
        break;
      }
      case '7': {
        console.log(`\n${C.yellow}=== Current Configuration (${CONFIG_PATH}) ===${C.reset}`);
        const clean = JSON.parse(JSON.stringify(config));
        if (clean.db?.password) clean.db.password = '••••••••';
        console.log(JSON.stringify(clean, null, 2));
        break;
      }
      default:
        console.log(`${C.red}Invalid option.${C.reset}`);
        break;
    }
  }
}

/**
 * Handle non-interactive command line flags.
 * Returns true if server should continue starting, or false if it should exit.
 */
async function handleCliFlags() {
  const args = process.argv.slice(2);

  // Check if interactive editor requested
  const isEditor = args.includes('--settings');

  if (isEditor) {
    const shouldStart = await runCliEditor();
    return shouldStart;
  }

  // Help flag
  if (args.includes('--help') || args.includes('-h') || args.includes('/?')) {
    printHelp();
    process.exit(0);
  }

  let modifiedConfig = false;
  const config = loadConfig();

  function getArgVal(flag) {
    const exactIdx = args.indexOf(flag);
    if (exactIdx !== -1 && exactIdx + 1 < args.length && !args[exactIdx + 1].startsWith('-')) {
      return args[exactIdx + 1];
    }
    const prefix = `${flag}=`;
    const eqArg = args.find((a) => a.startsWith(prefix));
    if (eqArg) {
      return eqArg.slice(prefix.length);
    }
    return null;
  }

  // Database flags
  const dbServer = getArgVal('--db-server') || getArgVal('--db-host');
  if (dbServer !== null) { config.db.server = dbServer; modifiedConfig = true; }

  const dbPort = getArgVal('--db-port');
  if (dbPort !== null) { config.db.port = parseInt(dbPort, 10) || 1433; modifiedConfig = true; }

  const dbName = getArgVal('--db-name') || getArgVal('--db-database') || getArgVal('--database');
  if (dbName !== null) { config.db.database = dbName; modifiedConfig = true; }

  const dbUser = getArgVal('--db-user') || getArgVal('--user');
  if (dbUser !== null) { config.db.user = dbUser; modifiedConfig = true; }

  const dbPass = getArgVal('--db-pass') || getArgVal('--db-password') || getArgVal('--password');
  if (dbPass !== null) { config.db.password = dbPass; modifiedConfig = true; }

  const dbEncrypt = getArgVal('--db-encrypt');
  if (dbEncrypt !== null) { config.db.encrypt = dbEncrypt === 'true' || dbEncrypt === '1' || dbEncrypt === 'yes'; modifiedConfig = true; }

  const dbTrust = getArgVal('--db-trust');
  if (dbTrust !== null) { config.db.trustServerCertificate = dbTrust !== 'false' && dbTrust !== '0' && dbTrust !== 'no'; modifiedConfig = true; }

  // Network flags
  const httpPort = getArgVal('--http-port') || getArgVal('--port');
  if (httpPort !== null) { config.network = config.network || {}; config.network.httpPort = parseInt(httpPort, 10) || 8087; modifiedConfig = true; }

  const httpsPort = getArgVal('--https-port');
  if (httpsPort !== null) { config.network = config.network || {}; config.network.httpsPort = parseInt(httpsPort, 10) || 4447; modifiedConfig = true; }

  const authToken = getArgVal('--auth-token');
  if (authToken !== null) { config.auth = config.auth || {}; config.auth.authToken = authToken; modifiedConfig = true; }

  // Shop flags
  const mandantId = getArgVal('--mandant-id') || getArgVal('--mandant');
  if (mandantId !== null) { config.shop = config.shop || {}; config.shop.mandantId = parseInt(mandantId, 10) || 0; modifiedConfig = true; }

  const mandantDb = getArgVal('--mandant-db');
  if (mandantDb !== null) { config.shop = config.shop || {}; config.shop.database = mandantDb; modifiedConfig = true; }

  const steuerzoneId = getArgVal('--steuerzone-id') || getArgVal('--taxzone');
  if (steuerzoneId !== null) { config.shop = config.shop || {}; config.shop.steuerzoneId = parseInt(steuerzoneId, 10) || 0; modifiedConfig = true; }

  const warenlagerId = getArgVal('--warenlager-id') || getArgVal('--warehouse');
  if (warenlagerId !== null) { config.shop = config.shop || {}; config.shop.warenlagerId = parseInt(warenlagerId, 10) || 0; modifiedConfig = true; }

  const spracheId = getArgVal('--sprache-id') || getArgVal('--language');
  if (spracheId !== null) { config.shop = config.shop || {}; config.shop.spracheId = parseInt(spracheId, 10) || 0; modifiedConfig = true; }

  const rootKatId = getArgVal('--kategorie-id') || getArgVal('--category');
  if (rootKatId !== null) { config.shop = config.shop || {}; config.shop.rootKategorieId = parseInt(rootKatId, 10) || 0; modifiedConfig = true; }

  // Save if flags modified
  if (modifiedConfig) {
    saveConfig(config);
    console.log(`${C.green}✓ Saved updated configuration settings.${C.reset}`);
  }

  // Certificate direct commands
  if (args.includes('--gen-cert')) {
    console.log('Generating fresh TLS certificate...');
    const result = await cert.generateCert();
    const meta = readCertMetadata(result.cert);
    console.log(`${C.green}✓ Generated certificate with fingerprint: ${meta.serverFingerprint}${C.reset}`);
  }

  const exportCertPath = getArgVal('--export-cert');
  if (exportCertPath) {
    const pem = cert.getPublicKeyPem();
    if (!pem) {
      console.error(`${C.red}No certificate found to export.${C.reset}`);
    } else {
      fs.writeFileSync(exportCertPath, pem, 'utf-8');
      console.log(`${C.green}✓ Certificate public key exported to: ${exportCertPath}${C.reset}`);
    }
  }

  if (args.includes('--show-cert')) {
    const pem = cert.getPublicKeyPem();
    if (!pem) {
      console.log('No certificate found.');
    } else {
      const meta = readCertMetadata(pem);
      console.log(`Fingerprint: ${meta.serverFingerprint}`);
      console.log(`Serial: ${meta.certificateSerialNumber}\n`);
      console.log(pem);
    }
  }

  // Pairing direct commands
  if (args.includes('--revoke-pin')) {
    pairingStore.revokePairingCode();
    console.log(`${C.green}✓ Revoked active pairing PIN.${C.reset}`);
  }

  if (args.includes('--list-devices')) {
    const devices = pairingStore.getPairedDevices();
    console.log(`\nPaired Devices (${devices.length}):`);
    devices.forEach((d, i) => console.log(` [${i + 1}] ${d.name} (Token: ${d.token.slice(0, 8)}... | IP: ${d.clientIp || 'N/A'})`));
    console.log('');
  }

  const removeDeviceToken = getArgVal('--remove-device');
  if (removeDeviceToken) {
    pairingStore.removePairedDevice(removeDeviceToken);
    console.log(`${C.green}✓ Removed paired device: ${removeDeviceToken}${C.reset}`);
  }

  // Test DB direct command
  if (args.includes('--test-db') || args.includes('--test-connection')) {
    console.log(`Testing connection to ${config.db.server}:${config.db.port || 1433}/${config.db.database}...`);
    const res = await testDbConnection(config.db);
    if (res.success) {
      console.log(`${C.green}✓ MSSQL connection SUCCESS! Server time: ${res.serverTime} (${res.durationMs}ms)${C.reset}`);
    } else {
      console.error(`${C.red}✗ MSSQL connection FAILED: ${res.error}${C.reset}`);
    }
  }

  // Show config direct command
  if (args.includes('--show-config')) {
    const clean = JSON.parse(JSON.stringify(config));
    if (clean.db?.password) clean.db.password = '••••••••';
    console.log(JSON.stringify(clean, null, 2));
  }

  // If user only wanted to run a utility command (not start server)
  const isUtilityOnly = args.some((a) =>
    ['--save-only', '--no-start', '--test-db', '--show-config', '--show-cert', '--list-devices', '--gen-cert', '--revoke-pin'].includes(a)
  ) && !args.includes('--start');

  if (isUtilityOnly) {
    process.exit(0);
  }

  return true; // continue starting server
}

function printHelp() {
  console.log(`
${C.cyan}${C.bright}QuixPOS2JTL Server & CLI Settings Tool${C.reset}

${C.yellow}Interactive Mode:${C.reset}
  node src/service/server.js --settings        Open the interactive CLI Settings Editor

${C.yellow}Direct Configuration Flags:${C.reset}
  --db-server <host>          Set MSSQL Server host/IP
  --db-port <port>            Set MSSQL Server port (default 1433)
  --db-name <database>        Set Database name (e.g. eazybusiness)
  --db-user <user>            Set MSSQL User
  --db-pass <password>        Set MSSQL Password
  --db-encrypt <true|false>   Enable/disable connection encryption
  --db-trust <true|false>     Trust self-signed server certificate
  --http-port <port>          Set HTTP Server Port (default 8087)
  --https-port <port>         Set HTTPS POS Port (default 4447)
  --mandant-id <id>           Set JTL Mandant ID
  --mandant-db <db>           Set JTL Mandant Database name
  --taxzone <id>              Set Steuerzone ID
  --warehouse <id>            Set Warenlager ID
  --language <id>             Set Sprache ID
  --category <id>             Set Root Category ID

${C.yellow}Pairing & Certificate Commands:${C.reset}
  --pin <pin>                 Set active pairing PIN for JTL-POS
  --newpin                    Generate a new random 6-digit PIN
  --revoke-pin                Revoke active PIN
  --list-devices              List all paired POS registers
  --remove-device <token>     Remove a paired register by token
  --gen-cert                  Generate fresh TLS certificate
  --export-cert <file>        Export public key .crt to file
  --show-cert                 Print certificate details & PEM
  --test-db                   Test MSSQL connection and exit
  --show-config               Print current configuration
  --save-only                 Apply configuration flags and exit without starting
  --help, -h                  Show this help screen
`);
}

module.exports = {
  runCliEditor,
  handleCliFlags,
  testDbConnection,
  queryDatabases,
  queryShopOptions,
};
