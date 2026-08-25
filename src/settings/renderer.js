/**
 * Settings window renderer script.
 * Communicates with main process via the `api` bridge (see preload.js).
 */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupPasswordToggle();
  setupPairing();
  setupLogs();
  await loadConfig();
  await refreshCertStatus();
  await setupCertSuggestions();
  await refreshPairingState();
  await refreshServiceStatus();
  bindActions();

  // If a database is already configured, populate the shop dropdowns right away
  if (isDatabaseSelected()) {
    await refreshShopOptions();
  }
}

// ─── Tabs ──────────────────────────────────────────────────────

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.remove('hidden');

      if (tab.dataset.tab === 'pairing') {
        refreshPairingState();
      } else if (tab.dataset.tab === 'logs') {
        fetchLogs();
      } else if (tab.dataset.tab === 'service') {
        refreshServiceStatus();
      } else if (tab.dataset.tab === 'certificate') {
        refreshCertStatus();
      }
    });
  });
}

// ─── Password Toggle ──────────────────────────────────────────

function setupPasswordToggle() {
  const btn = document.getElementById('togglePassword');
  const input = document.getElementById('dbPassword');
  btn.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

// ─── Config ────────────────────────────────────────────────────

async function loadConfig() {
  const cfg = await window.api.getConfig();

  // Database
  document.getElementById('dbServer').value = cfg.db?.server || '';
  document.getElementById('dbPort').value = cfg.db?.port || 1433;
  document.getElementById('dbUser').value = cfg.db?.user || '';
  document.getElementById('dbPassword').value = cfg.db?.password || '';
  document.getElementById('dbEncrypt').checked = !!cfg.db?.encrypt;
  document.getElementById('dbTrustCert').checked = cfg.db?.trustServerCertificate !== false;

  // If a database is configured, show it as the selected option until refreshed
  const dbSelect = document.getElementById('dbDatabase');
  dbSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = cfg.db?.database || '';
  opt.textContent = cfg.db?.database || '— Enter server & login, then refresh —';
  dbSelect.appendChild(opt);

  // Network
  document.getElementById('httpPort').value = cfg.network?.httpPort || 8087;
  document.getElementById('httpsPort').value = cfg.network?.httpsPort || 4447;

  // Shop
  shopState.mandantId = cfg.shop?.mandantId ?? null;
  shopState.kShop = cfg.shop?.kShop ?? null;
  shopState.kBenutzer = cfg.shop?.kBenutzer ?? null;

  updateShopTabAvailability();
}

// ─── Shop Tab ──────────────────────────────────────────────────

const shopState = {
  mandantId: null,
  kShop: null,
  kBenutzer: null,
  shops: [],
  users: [],
};

function isDatabaseSelected() {
  return !!document.getElementById('dbDatabase').value;
}

function updateShopTabAvailability() {
  const enabled = isDatabaseSelected();
  const tabBtn = document.getElementById('tabBtnShop');
  const locked = document.getElementById('shopLocked');
  const form = document.getElementById('shopForm');
  tabBtn.disabled = !enabled;
  tabBtn.title = enabled ? '' : 'Connect to a database first';
  locked.classList.toggle('hidden', enabled);
  form.classList.toggle('hidden', !enabled);
}

async function refreshShopOptions() {
  if (!isDatabaseSelected()) {
    updateShopTabAvailability();
    return;
  }
  updateShopTabAvailability();

  const dbConfig = gatherConfig().db;
  const res = await window.api.listMandants(dbConfig);
  if (!res.success) {
    const result = document.getElementById('testResult');
    result.textContent = `✗ Mandants: ${res.error}`;
    result.className = 'test-result error';
    return;
  }

  const mandantSelect = document.getElementById('shopMandant');
  mandantSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Select mandant —';
  mandantSelect.appendChild(placeholder);

  for (const m of res.mandants) {
    const opt = document.createElement('option');
    opt.value = String(m.kMandant);
    opt.textContent = `${m.cName} (${m.kMandant})`;
    opt.dataset.db = m.cDB || '';
    mandantSelect.appendChild(opt);
  }
  if (shopState.mandantId && res.mandants.some((m) => m.kMandant === shopState.mandantId)) {
    mandantSelect.value = String(shopState.mandantId);
  }

  await onMandantChanged(true);
}

async function onMandantChanged(loadOptions = true) {
  const mandantSelect = document.getElementById('shopMandant');
  const selected = mandantSelect.selectedOptions[0];
  const dbHint = document.getElementById('shopMandantDb');
  const mandantDb = selected?.dataset.db || '';

  // A mandant may point to a different database — show it and use it for lookups
  dbHint.textContent = mandantDb ? `Database: ${mandantDb}` : '';

  if (!loadOptions || !mandantSelect.value) return;

  const dbConfig = gatherConfig().db;
  // Query against the mandant's own database if it differs
  const effectiveDb = mandantDb || dbConfig.database;
  const res = await window.api.listShops({ ...dbConfig, database: effectiveDb });
  if (!res.success) {
    const result = document.getElementById('testResult');
    result.textContent = `✗ Shops: ${res.error}`;
    result.className = 'test-result error';
    return;
  }

  shopState.shops = res.shops || [];
  shopState.users = res.users || [];

  // Populate Shops
  const shopSelect = document.getElementById('shopSelect');
  shopSelect.innerHTML = '';
  const shopPlaceholder = document.createElement('option');
  shopPlaceholder.value = '';
  shopPlaceholder.textContent = '— Select Shop —';
  shopSelect.appendChild(shopPlaceholder);

  for (const s of shopState.shops) {
    const opt = document.createElement('option');
    opt.value = String(s.kShop);
    opt.textContent = `${s.cName} (ID: ${s.kShop})`;
    shopSelect.appendChild(opt);
  }

  if (shopState.kShop && shopState.shops.some((s) => s.kShop === shopState.kShop)) {
    shopSelect.value = String(shopState.kShop);
  }

  // Populate Benutzer
  const benutzerSelect = document.getElementById('shopBenutzer');
  benutzerSelect.innerHTML = '';
  const userPlaceholder = document.createElement('option');
  userPlaceholder.value = '';
  userPlaceholder.textContent = '— Select Benutzer —';
  benutzerSelect.appendChild(userPlaceholder);

  for (const u of shopState.users) {
    const opt = document.createElement('option');
    opt.value = String(u.kBenutzer);
    opt.textContent = `${u.cName} (ID: ${u.kBenutzer})`;
    benutzerSelect.appendChild(opt);
  }

  if (shopState.kBenutzer && shopState.users.some((u) => u.kBenutzer === shopState.kBenutzer)) {
    benutzerSelect.value = String(shopState.kBenutzer);
  }

  updateDerivedShopDetails();
}

function updateDerivedShopDetails() {
  const shopSelect = document.getElementById('shopSelect');
  const detailsContainer = document.getElementById('shopDerivedDetails');
  const selectedShopId = parseInt(shopSelect.value, 10);
  const shop = shopState.shops.find((s) => s.kShop === selectedShopId);
  if (!shop) {
    detailsContainer.classList.add('hidden');
    return;
  }

  detailsContainer.classList.remove('hidden');
  document.getElementById('detailFirma').textContent = `${shop.cFirmaName || 'Firma #' + shop.kFirma} (${shop.cLandISO || '—'})`;
  document.getElementById('detailSteuerzone').textContent = shop.cSteuerzoneName
    ? `${shop.cSteuerzoneName} (ID: ${shop.kSteuerzone ?? 0})`
    : (shop.kSteuerzone ? `ID: ${shop.kSteuerzone}` : '—');
  document.getElementById('detailWarenlager').textContent = shop.cWarenlagerName
    ? `${shop.cWarenlagerName} (ID: ${shop.kWarenlager ?? 0})`
    : (shop.kWarenlager ? `ID: ${shop.kWarenlager}` : '—');
  document.getElementById('detailSprache').textContent = shop.cSpracheName
    ? `${shop.cSpracheName} (ID: ${shop.kSprache ?? 0})`
    : (shop.kSprache ? `ID: ${shop.kSprache}` : '—');
  document.getElementById('detailKategorie').textContent = shop.cKategorieName || (shop.kKategorie === 0 ? 'Alle Kategorien (Root / ID: 0)' : `ID: ${shop.kKategorie}`);
}

function gatherConfig() {
  return {
    db: {
      server: document.getElementById('dbServer').value.trim(),
      port: parseInt(document.getElementById('dbPort').value, 10) || 1433,
      database: document.getElementById('dbDatabase').value,
      user: document.getElementById('dbUser').value.trim(),
      password: document.getElementById('dbPassword').value,
      encrypt: document.getElementById('dbEncrypt').checked,
      trustServerCertificate: document.getElementById('dbTrustCert').checked,
    },
    network: {
      httpPort: parseInt(document.getElementById('httpPort').value, 10) || 8087,
      httpsPort: parseInt(document.getElementById('httpsPort').value, 10) || 4447,
    },
    shop: {
      mandantId: document.getElementById('shopMandant').value ? parseInt(document.getElementById('shopMandant').value, 10) : null,
      database: document.getElementById('shopMandant').selectedOptions[0]?.dataset.db
        || document.getElementById('dbDatabase').value,
      kShop: document.getElementById('shopSelect').value ? parseInt(document.getElementById('shopSelect').value, 10) : null,
      kBenutzer: document.getElementById('shopBenutzer').value ? parseInt(document.getElementById('shopBenutzer').value, 10) : null,
    },
  };
}

// ─── Actions ───────────────────────────────────────────────────

function bindActions() {
  // Save
  document.getElementById('btnSave').addEventListener('click', async () => {
    const btn = document.getElementById('btnSave');
    btn.classList.add('loading');
    const cfg = gatherConfig();
    await window.api.saveConfig(cfg);
    btn.classList.remove('loading');
    showSaveFeedback();
  });

  // Refresh database list
  document.getElementById('btnRefreshDatabases').addEventListener('click', refreshDatabaseList);

  // Shop tab
  document.getElementById('dbDatabase').addEventListener('change', () => {
    updateShopTabAvailability();
    if (isDatabaseSelected()) refreshShopOptions();
  });
  document.getElementById('btnRefreshShop').addEventListener('click', refreshShopOptions);
  document.getElementById('shopMandant').addEventListener('change', () => onMandantChanged(true));
  document.getElementById('shopSelect').addEventListener('change', () => {
    shopState.kShop = document.getElementById('shopSelect').value ? parseInt(document.getElementById('shopSelect').value, 10) : null;
    updateDerivedShopDetails();
  });
  document.getElementById('shopBenutzer').addEventListener('change', () => {
    shopState.kBenutzer = document.getElementById('shopBenutzer').value ? parseInt(document.getElementById('shopBenutzer').value, 10) : null;
  });

  // Test Connection
  document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const btn = document.getElementById('btnTestConnection');
    const result = document.getElementById('testResult');
    btn.classList.add('loading');
    result.textContent = '';
    result.className = 'test-result';

    const dbConfig = gatherConfig().db;
    const res = await window.api.testConnection(dbConfig);
    btn.classList.remove('loading');

    if (res.success) {
      result.textContent = `✓ Connected — Server time: ${new Date(res.serverTime).toLocaleString()}`;
      result.className = 'test-result success';
    } else {
      result.textContent = `✗ ${res.error}`;
      result.className = 'test-result error';
    }
  });

  // Generate Certificate
  document.getElementById('btnGenerateCert').addEventListener('click', async () => {
    const btn = document.getElementById('btnGenerateCert');
    const cnInput = document.getElementById('certCommonName');
    const altInput = document.getElementById('certAltNames');

    const commonName = cnInput ? cnInput.value.trim() : '';
    const altNames = altInput ? altInput.value.trim() : '';

    btn.classList.add('loading');
    const res = await window.api.generateCert({ commonName, altNames });
    btn.classList.remove('loading');

    if (res && res.success) {
      await refreshCertStatus();
    } else {
      const statusEl = document.getElementById('certStatus');
      if (statusEl) {
        statusEl.className = 'cert-status missing';
        statusEl.innerHTML = `<span class="cert-icon">❌</span><span>Generation failed: ${escapeHtml(res?.error || 'Unknown error')}</span>`;
      }
    }
  });

  // Export Certificate
  document.getElementById('btnExportCert').addEventListener('click', async () => {
    const dialogResult = await window.api.showSaveDialog({
      title: 'Export Public Key',
      defaultPath: 'quixpos2jtl-server.crt',
      filters: [
        { name: 'Certificate', extensions: ['crt', 'pem'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!dialogResult.canceled && dialogResult.filePath) {
      await window.api.exportCert(dialogResult.filePath);
    }
  });

  // Copy PEM
  document.getElementById('btnCopyPem').addEventListener('click', () => {
    const pem = document.getElementById('certPem').value;
    navigator.clipboard.writeText(pem);
    const btn = document.getElementById('btnCopyPem');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  // Service controls
  document.getElementById('btnStartService').addEventListener('click', async () => {
    const btn = document.getElementById('btnStartService');
    btn.classList.add('loading');
    await window.api.startService();
    btn.classList.remove('loading');
    await refreshServiceStatus();
    await fetchLogs(true);
  });

  document.getElementById('btnStopService').addEventListener('click', async () => {
    const btn = document.getElementById('btnStopService');
    btn.classList.add('loading');
    await window.api.stopService();
    btn.classList.remove('loading');
    // Wait a moment for process to exit
    setTimeout(async () => {
      await refreshServiceStatus();
      await fetchLogs(true);
    }, 500);
  });

  document.getElementById('btnInstallService').addEventListener('click', async () => {
    const btn = document.getElementById('btnInstallService');
    const result = document.getElementById('serviceResult');
    btn.classList.add('loading');
    result.textContent = 'Installing Windows service (accept UAC prompt)…';
    result.className = 'test-result';
    const res = await window.api.installService();
    btn.classList.remove('loading');
    if (res.success) {
      result.textContent = '✓ Service installed successfully';
      result.className = 'test-result success';
    } else {
      result.textContent = `✗ ${res.error}`;
      result.className = 'test-result error';
    }
    await refreshServiceStatus();
    await fetchLogs(true);
  });

  document.getElementById('btnUninstallService').addEventListener('click', async () => {
    const btn = document.getElementById('btnUninstallService');
    const result = document.getElementById('serviceResult');
    btn.classList.add('loading');
    result.textContent = 'Uninstalling service (accept UAC prompt)…';
    result.className = 'test-result';
    const res = await window.api.uninstallService();
    btn.classList.remove('loading');
    if (res.success) {
      result.textContent = '✓ Service uninstalled';
      result.className = 'test-result success';
    } else {
      result.textContent = `✗ ${res.error}`;
      result.className = 'test-result error';
    }
    await refreshServiceStatus();
    await fetchLogs(true);
  });

  // Ping via Named Pipe
  const btnPing = document.getElementById('btnPingPipe');
  if (btnPing) {
    btnPing.addEventListener('click', async () => {
      const result = document.getElementById('serviceResult');
      btnPing.classList.add('loading');
      result.textContent = 'Pinging service over Named Pipe (no TCP/IP)…';
      result.className = 'test-result';
      const res = await window.api.pingPipe();
      btnPing.classList.remove('loading');
      if (res.success) {
        result.textContent = `✓ Pipe Connected! Service PID: ${res.info?.pid || 'N/A'}, Uptime: ${Math.round(res.info?.uptime || 0)}s, HTTP Port: ${res.info?.httpPort || 8087}`;
        result.className = 'test-result success';
      } else {
        result.textContent = `✗ Pipe not reachable: ${res.error}`;
        result.className = 'test-result error';
      }
      await refreshServiceStatus();
    });
  }
}

// ─── Database List ─────────────────────────────────────────────

async function refreshDatabaseList() {
  const btn = document.getElementById('btnRefreshDatabases');
  const select = document.getElementById('dbDatabase');
  const result = document.getElementById('testResult');

  btn.classList.add('loading');
  result.textContent = '';
  result.className = 'test-result';

  const dbConfig = gatherConfig().db;
  if (!dbConfig.server || !dbConfig.user) {
    btn.classList.remove('loading');
    result.textContent = '✗ Enter server and login first';
    result.className = 'test-result error';
    return;
  }

  const res = await window.api.listDatabases(dbConfig);
  btn.classList.remove('loading');

  const previous = select.value;

  if (res.success) {
    select.innerHTML = '';
    for (const name of res.databases) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    // Restore previously selected database if still present
    if (res.databases.includes(previous)) {
      select.value = previous;
    }
    result.textContent = `✓ Found ${res.databases.length} database(s)`;
    result.className = 'test-result success';
    updateShopTabAvailability();
    await refreshShopOptions();
  } else {
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = previous || '';
    opt.textContent = previous || '— Could not load databases —';
    select.appendChild(opt);
    result.textContent = `✗ ${res.error}`;
    result.className = 'test-result error';
  }
}

// ─── Certificate Status & Suggestions ──────────────────────────

async function setupCertSuggestions() {
  const container = document.getElementById('certSuggestionChips');
  if (!container) return;

  try {
    const netInfo = await window.api.getLocalIps();
    container.innerHTML = '';

    const suggestions = [];
    if (netInfo.ips && netInfo.ips.length > 0) {
      netInfo.ips.forEach((ip) => {
        suggestions.push({ label: ip, value: ip });
      });
    }
    if (netInfo.hostname && netInfo.hostname !== 'localhost') {
      suggestions.push({ label: netInfo.hostname, value: netInfo.hostname });
    }
    suggestions.push({ label: 'localhost', value: 'localhost' });

    suggestions.forEach((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggestion-chip';
      chip.textContent = item.label;
      chip.addEventListener('click', () => {
        const cnInput = document.getElementById('certCommonName');
        if (cnInput) {
          cnInput.value = item.value;
          cnInput.focus();
        }
        document.querySelectorAll('.suggestion-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      container.appendChild(chip);
    });

    // Default common name input if blank
    const cnInput = document.getElementById('certCommonName');
    if (cnInput && !cnInput.value) {
      cnInput.value = suggestions[0]?.value || 'localhost';
    }
  } catch (err) {
    console.error('Failed to load local IP suggestions:', err);
  }
}

async function refreshCertStatus() {
  const info = await window.api.getCertInfo();
  const statusEl = document.getElementById('certStatus');
  const badgeEl = document.getElementById('certBadge');
  const metaGrid = document.getElementById('certMetaGrid');
  const pemWrapper = document.getElementById('certPemWrapper');
  const pemTextarea = document.getElementById('certPem');
  const exportBtn = document.getElementById('btnExportCert');

  if (info.exists) {
    statusEl.className = 'cert-status exists';
    statusEl.innerHTML = '<span class="cert-icon">🔒</span><span>TLS Certificate is active and ready</span>';

    if (badgeEl) {
      badgeEl.textContent = 'Active';
      badgeEl.className = 'badge badge-success';
      badgeEl.classList.remove('hidden');
    }

    if (info.meta && metaGrid) {
      document.getElementById('certMetaCn').textContent = info.meta.commonName || 'localhost';
      document.getElementById('certMetaSan').textContent = info.meta.subjectAltNames || 'None';
      document.getElementById('certMetaValidTo').textContent = info.meta.validTo || 'N/A';
      document.getElementById('certMetaFingerprint').textContent = info.meta.serverFingerprint || info.meta.certificateFingerprint || 'N/A';
      metaGrid.classList.remove('hidden');

      const cnInput = document.getElementById('certCommonName');
      if (cnInput && !cnInput.value) {
        cnInput.value = info.meta.commonName || '';
      }
    }

    if (pemWrapper) pemWrapper.classList.remove('hidden');
    if (pemTextarea) pemTextarea.value = info.publicKey || '';
    if (exportBtn) exportBtn.disabled = false;
  } else {
    statusEl.className = 'cert-status missing';
    statusEl.innerHTML = '<span class="cert-icon">⚠️</span><span>No certificate found — generate one for HTTPS</span>';

    if (badgeEl) badgeEl.classList.add('hidden');
    if (metaGrid) metaGrid.classList.add('hidden');
    if (pemWrapper) pemWrapper.classList.add('hidden');
    if (exportBtn) exportBtn.disabled = true;
  }
}

// ─── Service Status ────────────────────────────────────────────

async function refreshServiceStatus() {
  const status = await window.api.getServiceStatus();
  const badge = document.getElementById('statusBadge');
  const modeEl = document.getElementById('svcMode');
  const statusEl = document.getElementById('svcStatus');
  const pipeEl = document.getElementById('svcPipe');
  const pipeStatusEl = document.getElementById('svcPipeStatus');

  // Update header badge
  badge.className = `status-badge ${status.running ? 'running' : 'stopped'}`;
  badge.querySelector('.status-text').textContent = status.running ? 'Running' : 'Stopped';

  // Update service tab
  modeEl.textContent = status.mode === 'windows-service' ? 'Windows Service' : 'Embedded';
  statusEl.textContent = status.serviceStatus.charAt(0).toUpperCase() + status.serviceStatus.slice(1);

  if (pipeEl && status.pipe) {
    pipeEl.textContent = status.pipe;
  }

  // Check live pipe connectivity asynchronously
  if (status.running && pipeStatusEl) {
    window.api.pingPipe().then((res) => {
      if (res && res.success) {
        const transportInfo = res.transport && res.transport !== 'pipe' ? ` (via ${res.transport})` : '';
        pipeStatusEl.textContent = `Active (PID ${res.info?.pid || status.runtime?.pid || 'running'})${transportInfo}`;
        pipeStatusEl.style.color = 'var(--success)';
      } else {
        pipeStatusEl.textContent = res?.error ? `Offline (${res.error})` : 'Offline';
        pipeStatusEl.style.color = 'var(--danger)';
      }
    }).catch((err) => {
      pipeStatusEl.textContent = 'Disconnected';
      pipeStatusEl.style.color = 'var(--danger)';
    });
  } else if (pipeStatusEl) {
    pipeStatusEl.textContent = 'Service stopped';
    pipeStatusEl.style.color = 'var(--text-muted)';
  }

  // Toggle buttons
  document.getElementById('btnStartService').disabled = status.running;
  document.getElementById('btnStopService').disabled = !status.running;
  document.getElementById('btnInstallService').disabled = status.installed;
  document.getElementById('btnUninstallService').disabled = !status.installed;
}

// ─── Helpers ───────────────────────────────────────────────────

function showSaveFeedback() {
  const el = document.getElementById('saveFeedback');
  el.textContent = '✓ Settings saved';
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ─── Pairing Tab ───────────────────────────────────────────────

let activePairingCode = null;
let pairingPollInterval = null;
let lastPairingFingerprint = '';

function setupPairing() {
  const btnGenerate = document.getElementById('btnGeneratePin');
  const btnCopy = document.getElementById('btnCopyPin');
  const btnRevoke = document.getElementById('btnRevokePin');

  if (btnGenerate) {
    btnGenerate.addEventListener('click', async () => {
      btnGenerate.classList.add('loading');
      await window.api.generatePairingCode('JTL-POS');
      btnGenerate.classList.remove('loading');
      await refreshPairingState(true);
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (activePairingCode) {
        navigator.clipboard.writeText(activePairingCode);
        const orig = btnCopy.textContent;
        btnCopy.textContent = 'Copied!';
        setTimeout(() => { btnCopy.textContent = orig; }, 1500);
      }
    });
  }

  if (btnRevoke) {
    btnRevoke.addEventListener('click', async () => {
      if (activePairingCode) {
        btnRevoke.classList.add('loading');
        await window.api.revokePairingCode(activePairingCode);
        btnRevoke.classList.remove('loading');
        await refreshPairingState(true);
      }
    });
  }

  // Live polling when Pairing tab is open
  if (pairingPollInterval) clearInterval(pairingPollInterval);
  pairingPollInterval = setInterval(async () => {
    const tab = document.getElementById('tab-pairing');
    if (tab && !tab.classList.contains('hidden')) {
      await refreshPairingState(false);
    }
  }, 1500);
}

async function refreshPairingState(force = false) {
  const res = await window.api.getPairingState();
  if (!res || !res.success) return;

  const activeCodes = res.pairingCodes || [];
  const pairedDevices = res.pairedDevices || [];

  const fingerprint = JSON.stringify({ activeCodes, pairedDevices });
  if (!force && fingerprint === lastPairingFingerprint) {
    return; // No change — skip DOM updates to prevent clearing user text selection
  }
  lastPairingFingerprint = fingerprint;

  const display = document.getElementById('activePinDisplay');
  const metaText = document.getElementById('pinMetaText');
  const btnCopy = document.getElementById('btnCopyPin');
  const btnRevoke = document.getElementById('btnRevokePin');
  const countBadge = document.getElementById('deviceCountBadge');
  const devicesList = document.getElementById('pairedDevicesList');

  // Update PIN section
  if (activeCodes.length > 0) {
    const latest = activeCodes[0];
    activePairingCode = latest.code;
    const formatted = latest.code.split('').join(' ');
    display.textContent = formatted;
    display.style.color = '#38bdf8';
    const time = latest.createdAt ? new Date(latest.createdAt).toLocaleTimeString() : '';
    metaText.textContent = `Active PIN generated at ${time} for "${latest.name || 'JTL-POS'}"`;
    btnCopy.disabled = false;
    btnRevoke.disabled = false;
  } else {
    activePairingCode = null;
    display.textContent = '— — — — — —';
    display.style.color = 'var(--text-muted)';
    metaText.textContent = 'No active PIN generated — click Generate New PIN';
    btnCopy.disabled = true;
    btnRevoke.disabled = true;
  }

  // Update Paired Devices section
  if (countBadge) {
    countBadge.textContent = String(pairedDevices.length);
  }

  if (devicesList) {
    if (pairedDevices.length === 0) {
      devicesList.innerHTML = '<div class="devices-empty">No POS devices paired yet. Generate a PIN above and connect from JTL-POS.</div>';
    } else {
      devicesList.innerHTML = pairedDevices.map((device) => {
        const pairedDate = device.pairedAt ? new Date(device.pairedAt).toLocaleString() : '—';
        const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—';
        const ip = device.clientIp ? ` • IP: ${device.clientIp}` : '';
        const tokenDisplay = device.token ? `${device.token.slice(0, 8)}...${device.token.slice(-4)}` : '—';

        return `
          <div class="device-item">
            <div class="device-info">
              <div class="device-name">${escapeHtml(device.name || 'JTL-POS Register')}</div>
              <div class="device-token">Token: ${escapeHtml(tokenDisplay)}</div>
              <div class="device-meta">Paired: ${escapeHtml(pairedDate)} • Last seen: ${escapeHtml(lastSeen)}${escapeHtml(ip)}</div>
            </div>
            <div class="device-actions">
              <button class="btn btn-danger-outline btn-small" onclick="removeDevice('${escapeHtml(device.token)}')">
                Remove
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Global hook for device removal
window.removeDevice = async function (token) {
  await window.api.removePairedDevice(token);
  await refreshPairingState(true);
};

// ─── Logs Tab ──────────────────────────────────────────────────

let currentLogs = [];
let logsPollInterval = null;

function setupLogs() {
  const filterSelect = document.getElementById('logLevelFilter');
  const searchInput = document.getElementById('logSearchInput');
  const clearBtn = document.getElementById('btnClearLogs');
  const copyBtn = document.getElementById('btnCopyLogs');

  if (filterSelect) filterSelect.addEventListener('change', renderLogs);
  if (searchInput) searchInput.addEventListener('input', renderLogs);

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await window.api.clearLogs();
      currentLogs = [];
      renderLogs();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = currentLogs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
      navigator.clipboard.writeText(text);
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    });
  }

  // Start polling every 1.5 seconds
  if (logsPollInterval) clearInterval(logsPollInterval);
  logsPollInterval = setInterval(fetchLogs, 1500);
}

let lastRenderedLogCount = 0;
let lastRenderedLastId = 0;

async function fetchLogs(force = false) {
  const logsTab = document.getElementById('tab-logs');
  if (!logsTab || logsTab.classList.contains('hidden')) {
    return;
  }

  try {
    const res = await window.api.getLogs({ limit: 300 });
    if (res && res.success && Array.isArray(res.logs)) {
      const newLogs = res.logs;
      const count = newLogs.length;
      const lastId = count > 0 ? (newLogs[count - 1]?.id || newLogs[count - 1]?.timestamp) : 0;

      if (!force && count === lastRenderedLogCount && lastId === lastRenderedLastId) {
        return; // No new logs arrived, don't wipe text selection
      }

      lastRenderedLogCount = count;
      lastRenderedLastId = lastId;
      currentLogs = newLogs;
      renderLogs();
    }
  } catch {
    // ignore
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLogs() {
  const terminal = document.getElementById('logsTerminal');
  if (!terminal) return;

  const levelFilter = document.getElementById('logLevelFilter')?.value || 'ALL';
  const searchQuery = (document.getElementById('logSearchInput')?.value || '').toLowerCase().trim();
  const autoScroll = document.getElementById('logAutoScroll')?.checked ?? true;

  let filtered = [...currentLogs].reverse();
  if (levelFilter !== 'ALL') {
    filtered = filtered.filter((l) => l.level === levelFilter);
  }
  if (searchQuery) {
    filtered = filtered.filter((l) => (l.message || '').toLowerCase().includes(searchQuery));
  }

  if (filtered.length === 0) {
    terminal.innerHTML = '<div class="log-empty">No logs to display</div>';
    return;
  }

  const rows = filtered.map((l) => {
    const time = (l.timestamp || '').split('T')[1]?.replace('Z', '') || l.timestamp || '';
    const badgeClass = `badge-${l.level || 'INFO'}`;
    return `<div class="log-row">
      <span class="log-time">${escapeHtml(time)}</span>
      <span class="log-badge ${badgeClass}">${escapeHtml(l.level || 'INFO')}</span>
      <span class="log-msg">${escapeHtml(l.message || '')}</span>
    </div>`;
  }).join('');

  terminal.innerHTML = rows;

  if (autoScroll) {
    terminal.scrollTop = 0;
  }
}
