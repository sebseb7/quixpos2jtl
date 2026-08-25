/**
 * Build script for packaging QuixPOS2JTL CLI for Linux.
 * 
 * Compiles a standalone native ELF x64 Linux binary (no Node.js installation required),
 * generates systemd service units, install/uninstall scripts, and creates a .tar.gz archive.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const LINUX_PKG_DIR = path.join(DIST_DIR, 'quixpos2jtl-cli-linux');
const SYSTEMD_DIR = path.join(LINUX_PKG_DIR, 'systemd');
const TARBALL_PATH = path.join(DIST_DIR, 'quixpos2jtl-cli-linux-x64.tar.gz');

console.log('============================================================');
console.log('       Packaging QuixPOS2JTL CLI for Linux (x64)');
console.log('============================================================');

// 1. Prepare directories
fs.mkdirSync(SYSTEMD_DIR, { recursive: true });

// 2. Compile standalone Linux ELF executable with pkg
console.log('\n[1/5] Compiling standalone Linux ELF x64 binary with pkg...');
const outputBin = path.join(LINUX_PKG_DIR, 'quixpos2jtl');
const pkgCmd = `npx @yao-pkg/pkg bin/quixpos2jtl.js --target node22-linux-x64 --output "${outputBin}" --compress GZip --public --public-packages "*" --no-bytecode`;

try {
  execSync(pkgCmd, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`✓ Standalone Linux binary created: ${outputBin}`);
} catch (err) {
  console.error(`✗ pkg compilation failed: ${err.message}`);
  process.exit(1);
}

// 3. Generate systemd service unit
console.log('\n[2/5] Generating systemd unit file (quixpos2jtl.service)...');
const systemdContent = `[Unit]
Description=QuixPOS2JTL POS & REST Synchronization Service
Documentation=https://github.com/QuixPOS/quixpos2jtl
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/etc/quixpos2jtl
ExecStart=/usr/local/bin/quixpos2jtl
Restart=always
RestartSec=5
KillMode=process
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=QUIXPOS2JTL_CONFIG_DIR=/etc/quixpos2jtl

# Hardening / Sandboxing
LimitNOFILE=65536
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
`;
fs.writeFileSync(path.join(SYSTEMD_DIR, 'quixpos2jtl.service'), systemdContent, 'utf-8');

// 4. Generate install.sh
console.log('[3/5] Generating Linux install.sh script...');
const installShContent = `#!/usr/bin/env bash
set -e

# QuixPOS2JTL Linux CLI & Service Installer
if [ "$EUID" -ne 0 ]; then
  echo "Error: Root privileges required. Please run: sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BIN_SRC="$SCRIPT_DIR/quixpos2jtl"
BIN_DEST="/usr/local/bin/quixpos2jtl"
SERVICE_SRC="$SCRIPT_DIR/systemd/quixpos2jtl.service"
SERVICE_DEST="/etc/systemd/system/quixpos2jtl.service"
CONFIG_DIR="/etc/quixpos2jtl"

echo "============================================================"
echo "          Installing QuixPOS2JTL CLI for Linux"
echo "============================================================"

# Ensure directories
mkdir -p "$CONFIG_DIR/certs"
mkdir -p "$CONFIG_DIR/logs"
chmod 755 "$CONFIG_DIR"

# Install standalone binary
echo "• Installing binary to $BIN_DEST..."
cp "$BIN_SRC" "$BIN_DEST"
chmod 755 "$BIN_DEST"

# Install systemd service if systemd exists
if [ -d "/etc/systemd/system" ]; then
  echo "• Installing systemd service unit..."
  cp "$SERVICE_SRC" "$SERVICE_DEST"
  chmod 644 "$SERVICE_DEST"
  systemctl daemon-reload
  systemctl enable quixpos2jtl.service
  echo "• Starting quixpos2jtl service..."
  systemctl restart quixpos2jtl.service || true
  echo "✓ Systemd service enabled and started"
fi

echo ""
echo "============================================================"
echo "✓ Installation successful!"
echo "============================================================"
echo "Commands:"
echo "  quixpos2jtl --settings        # Open interactive CLI settings editor"
echo "  quixpos2jtl --help            # Display CLI options & flags"
echo "  quixpos2jtl --newpin          # Generate a new POS pairing PIN"
echo "  quixpos2jtl --test-db         # Test MSSQL connection"
echo ""
echo "Systemd service commands:"
echo "  systemctl status quixpos2jtl  # Check daemon status"
echo "  systemctl restart quixpos2jtl # Restart service"
echo "  journalctl -u quixpos2jtl -f  # Tail live logs"
echo "============================================================"
`;
fs.writeFileSync(path.join(LINUX_PKG_DIR, 'install.sh'), installShContent, 'utf-8');

// 5. Generate uninstall.sh
console.log('[4/5] Generating Linux uninstall.sh script...');
const uninstallShContent = `#!/usr/bin/env bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Error: Root privileges required. Please run: sudo ./uninstall.sh"
  exit 1
fi

echo "============================================================"
echo "         Uninstalling QuixPOS2JTL CLI from Linux"
echo "============================================================"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet quixpos2jtl 2>/dev/null; then
    echo "• Stopping quixpos2jtl service..."
    systemctl stop quixpos2jtl 2>/dev/null || true
  fi
  if [ -f "/etc/systemd/system/quixpos2jtl.service" ]; then
    echo "• Removing systemd service unit..."
    systemctl disable quixpos2jtl 2>/dev/null || true
    rm -f /etc/systemd/system/quixpos2jtl.service
    systemctl daemon-reload
  fi
fi

if [ -f "/usr/local/bin/quixpos2jtl" ]; then
  echo "• Removing binary /usr/local/bin/quixpos2jtl..."
  rm -f /usr/local/bin/quixpos2jtl
fi

echo ""
echo "✓ QuixPOS2JTL uninstalled successfully."
echo "Note: Configuration files at /etc/quixpos2jtl have been preserved."
echo "To remove data completely, run: rm -rf /etc/quixpos2jtl"
`;
fs.writeFileSync(path.join(LINUX_PKG_DIR, 'uninstall.sh'), uninstallShContent, 'utf-8');

// 6. Generate Linux README
const linuxReadme = `# QuixPOS2JTL CLI & Service for Linux (x64)

Standalone executable and systemd background service for Linux (Ubuntu, Debian, RHEL, Rocky, AlmaLinux, CentOS, Alpine, etc.).
No Node.js installation is required.

---

## 1. Quick Installation (Systemd Service)

Run the included install script with root privileges:

\`\`\`bash
sudo ./install.sh
\`\`\`

This will:
1. Copy \`quixpos2jtl\` to \`/usr/local/bin/quixpos2jtl\`.
2. Create configuration directories at \`/etc/quixpos2jtl/\`.
3. Register and start the \`quixpos2jtl.service\` systemd daemon.

---

## 2. Configuration

### Interactive CLI Settings Editor
Launch the terminal editor to configure database, ports, TLS certificates, and POS pairing:
\`\`\`bash
quixpos2jtl --settings
\`\`\`

### Direct Command-Line Flags
Configure headless without interactive prompts:
\`\`\`bash
# Configure MSSQL Connection
quixpos2jtl --db-server 192.168.1.50 --db-port 1433 --db-name eazybusiness --db-user sa --db-pass secret

# Shop Settings
quixpos2jtl --mandant-id 1 --taxzone 1 --warehouse 1 --language 1

# Generate POS Pairing PIN
quixpos2jtl --newpin

# Test MSSQL Connection
quixpos2jtl --test-db

# View Persisted Configuration
quixpos2jtl --show-config
\`\`\`

---

## 3. Managing the Service

\`\`\`bash
# Check status
sudo systemctl status quixpos2jtl

# Restart service after configuration changes
sudo systemctl restart quixpos2jtl

# View real-time logs
sudo journalctl -u quixpos2jtl -f -n 100

# Stop service
sudo systemctl stop quixpos2jtl
\`\`\`

---

## 4. Uninstallation

\`\`\`bash
sudo ./uninstall.sh
\`\`\`
`;
fs.writeFileSync(path.join(LINUX_PKG_DIR, 'README.md'), linuxReadme, 'utf-8');

// 7. Create .tar.gz archive
console.log('\n[5/5] Creating dist/quixpos2jtl-cli-linux-x64.tar.gz archive...');
try {
  const tarExe = process.platform === 'win32' ? 'tar.exe' : 'tar';
  execSync(`${tarExe} -czf "quixpos2jtl-cli-linux-x64.tar.gz" "quixpos2jtl-cli-linux"`, { cwd: DIST_DIR, stdio: 'inherit' });
  const stat = fs.statSync(TARBALL_PATH);
  console.log(`✓ Tarball archive created: ${TARBALL_PATH} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
} catch (err) {
  console.log(`ℹ Note creating tarball: ${err.message}. Bundle folder ready in dist/quixpos2jtl-cli-linux`);
}

console.log('\n============================================================');
console.log('✓ Linux CLI Package Ready at:');
console.log(`  Folder : ${LINUX_PKG_DIR}`);
if (fs.existsSync(TARBALL_PATH)) {
  console.log(`  Tarball: ${TARBALL_PATH}`);
}
console.log('============================================================\n');
