# QuixPOS2JTL

[![Build and Upload Installer](https://github.com/sebseb7/quixpos2jtl/actions/workflows/build-installer.yml/badge.svg)](https://github.com/sebseb7/quixpos2jtl/actions/workflows/build-installer.yml)
[![Installer SHA-256](https://byob.yarr.is/sebseb7/quixpos2jtl/installer_sha256)](https://github.com/sebseb7/quixpos2jtl/actions)

Electron system-tray application and Windows Service that hosts the complete **POS REST API Server** connected to a JTL-Wawi compatible Microsoft SQL Server database. The service can run **embedded** inside the Electron tray process or be **installed as an independent Windows system service** and controlled directly from the tray.

---

## Quick Start

```bash
npm install
npm start

# Or build the standalone Windows installer (.exe):
npm run build:installer
```

The app launches directly into the **Windows system tray**. Click the tray icon to open Settings, or right-click for the context menu.

---

## Installer Build

To build the production Windows NSIS installer package:
```bash
npm run build:installer
# Or: npm run dist
```
The standalone installer executable is generated at:
```
dist/QuixPOS2JTL Setup 1.1.0.exe
```
When installed on a POS server, it creates Start Menu shortcuts and packages the complete standalone background service with automatic Windows Firewall configuration.

---

## Architecture & Features

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron (Tray App)                      │
│  ┌───────────┐  ┌────────────────────────────────────────┐  │
│  │ Tray Icon │  │ Settings Dialog (7 Tabs)               │  │
│  │  + Menu   │  │  • Database     • Pairing (PIN/Devices)│  │
│  └─────┬─────┘  │  • Shop         • Service Manager      │  │
│        │        │  • Network      • Live Logs Terminal   │  │
│        │        │  • Certificate                         │  │
│        │        └────────────────────────────────────────┘  │
│  ┌─────▼────────────────────────┐                           │
│  │       Service Manager        │                           │
│  │  ┌──────────┬──────────────┐ │                           │
│  │  │ Embedded │ Win Service  │ │                           │
│  │  │  (fork)  │ (LocalSystem)│ │                           │
│  │  └──────────┴──────────────┘ │                           │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     REST API Service                        │
│   Express (HTTP :8087 / HTTPS :4447 / Windows Named Pipe)   │
│   ├── JTL-POS Core Protocol (/v1/*)                         │
│   │    ├── Pairing & Auth Handshake (/v1/client, /v1/newpin)│
│   │    ├── Master Data (/v1/init, category, product, etc.)  │
│   │    ├── Images & Resize (/v1/pimage, /v1/cimage)         │
│   │    └── Orders & Fulfillment (/v1/order)                 │
│   │         └── Warehouse Delivery & Shortage Resolution    │
│   ├── Internal Health & Diagnostics (/api/health, status)   │
│   └── Windows Firewall Manager (Auto-configures Inbound TCP)│
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

1. **Complete JTL-POS Server Engine**:
   - Master data synchronization: Categories, Products (with parent-child hierarchy, images, barcode, and Stücklisten composite products), Customers, and Customer Groups with tier pricing.
   - Order creation and multi-position processing.
   - Transactional warehouse fulfillment engine with stock shortage booking (`dbo.vLagerbestandProLager`).
   - Image serving with on-demand thumbnail generation and caching.

2. **Persistent Register Pairing**:
   - One-click 6-digit PIN generation in the tray GUI.
   - Single-use PIN consumption upon successful handshake.
   - Device tokens persistently stored in `%ProgramData%\quixpos2jtl\pairing.json`.
   - Live real-time update of paired devices list with instant revocation.

3. **Dual-Mode Operation**:
   - **Embedded Mode**: Runs as a lightweight child process of the tray application.
   - **Windows Service Mode**: Installs into Windows Service Control Manager (`QuixPOS2JTL`), running 24/7 in the background across user logoffs and system reboots.

4. **Automated Windows Firewall Management**:
   - Inbound TCP rules (`QuixPOS2JTL HTTP` and `QuixPOS2JTL HTTPS`) are automatically configured via `netsh advfirewall` upon service installation, server startup, and network port changes.

5. **Integrated Live Logs Terminal**:
   - Live stream of service events directly inside the tray settings UI.
   - Reverse-chronological order (newest logs at the top).
   - Log level filtering (INFO, OK, WARN, ERROR), instant search, auto-scroll toggle, and clipboard copy.

6. **Windows Named Pipe IPC**:
   - Fallback administrative communication over `\\.\pipe\quixpos2jtl` ensuring tray-to-service communication remains functional even during port conflicts.

---

## Configuration & Storage

All runtime configuration and credentials are saved in `%ProgramData%` to allow seamless sharing between the user-level Tray UI and the `LocalSystem` Windows Service:

| File / Folder | Purpose |
|---------------|---------|
| `%ProgramData%\quixpos2jtl\config.json` | Database, Shop, and Network port settings |
| `%ProgramData%\quixpos2jtl\pairing.json` | Active pairing PIN and authorized POS registers |
| `%ProgramData%\quixpos2jtl\certs\server.crt` | Self-signed TLS certificate public key |
| `%ProgramData%\quixpos2jtl\certs\server.key` | Self-signed TLS certificate private key |
| `%ProgramData%\quixpos2jtl\state.json` | Dynamic service PID, port, and uptime metadata |

---

## Settings Tabs

### 1. Database
- MSSQL Server Host, Port (default `1433`), User, and Password.
- Dynamic **Database Selection** dropdown (queries available databases from `sys.databases`).
- Dynamic **Mandant Selection** dropdown (queries registered mandants from `eazybusiness.dbo.tMandant`).
- Encryption and self-signed certificate trust toggles.
- **Test Connection** button for immediate verification.

### 2. Shop
- Automatically populates dropdowns directly from the selected database:
  - **Mandant**: Selected JTL tenant database (`kMandant`, `cDB`).
  - **Tax Zone**: Available tax zones (`tSteuerzone`).
  - **Warehouse**: Active warehouses (`tWarenLager`).
  - **Language**: Configured shop language (`tSpracheUsed`).
  - **Root Category**: Root category catalog filter (`tKategorieSprache`).

### 3. Network
- HTTP Port (`8087`) and HTTPS Port (`4447`).
- Automatic Windows Firewall inbound rule synchronization upon saving.

### 4. Certificate
- View Certificate Serial Number, SHA-1 Fingerprint, and expiration date.
- **Generate Self-Signed Certificate**, **Export .CRT**, and **Copy Certificate** actions.

### 5. Pairing
- **Generate New PIN**: Generates a 6-digit PIN for connecting JTL-POS registers.
- **Copy PIN** / **Revoke PIN**.
- **Paired POS Devices**: List of paired registers with Device Name, Token preview, IP address, and individual **Remove** buttons.

### 6. Service
- Install / Uninstall Windows Service.
- Start / Stop / Restart service controls.
- Automatic service status polling and runtime mode display.

### 7. Logs
- Live visual console showing recent service activity, queries, HTTP requests, and pairing actions.

---

## API Endpoints

### JTL-POS Core Protocol Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/client` | `GET` | Pairing handshake (Step 1: info query; Step 2: PIN verification & token issue) |
| `/v1/init` | `GET` | Sync initialization counts (products, categories, customers, etc.) |
| `/v1/category` | `GET` | Category hierarchy sync |
| `/v1/product` | `GET` | Product catalog with prices, stock, attributes, and image hashes |
| `/v1/productcomposite` | `GET` | Stücklisten composite product definitions |
| `/v1/deletedentity` | `GET` | Tombstone sync for deleted products and categories |
| `/v1/customergroup` | `GET` | Customer group definitions and discount percentages |
| `/v1/customer` | `GET` | Customer records and addresses |
| `/v1/pimage` | `GET` | Product image delivery (supports `?w=&h=` resizing and caching) |
| `/v1/cimage` | `GET` | Category image delivery |
| `/v1/order` | `POST` | Order intake, transaction booking, and stock shortage fulfillment |
| `/v1/order` | `GET` | Order search |
| `/v1/newpin` | `GET` | Terminal PIN generation |
| `/v1/crashreport` | `POST` | JTL-POS crash log receiver |

### Administrative & Diagnostic Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health`, `/api/health` | `GET` | Live SQL Server connectivity health check |
| `/api/status` | `GET` | Runtime service status, PID, uptime, ports, and pairing PIN |
| `/api/logs` | `GET`, `DELETE` | Fetch recent memory logs or clear logs |
| `/api/config/reload`| `POST` | Reload database connection pool and configuration from disk |

---

## Windows Service Management

### From the Settings UI
1. Open Settings → **Service** tab.
2. Click **Install as Service** (accept the Windows UAC elevation prompt).
3. The service is registered as `QuixPOS2JTL` and managed directly from the GUI.

### From the Command Line (Elevated PowerShell / CMD)
```bash
# Register & start Windows Service
node src/service/install.js

# Stop & remove Windows Service
node src/service/install.js --uninstall

# Standard Windows Service control
net start "quixpos2jtl.exe"
net stop "quixpos2jtl.exe"
```

---

## Project Structure

```
quixpos2jtl/
├── package.json
├── README.md
├── assets/
│   ├── icon.png               ← 512x512 scalable app icon (for Windows / NSIS)
│   └── tray-icon.png          ← 64x64 transparent tray glyph
└── src/
    ├── main.js                ← Electron main process (tray, window, IPC)
    ├── preload.js             ← Secure IPC bridge for renderer
    ├── config.js              ← Shared config read/write (%ProgramData%)
    ├── service-manager.js     ← Dual-mode service lifecycle manager
    ├── service/
    │   ├── server.js          ← Express HTTP + HTTPS + Named Pipe server
    │   ├── db.js              ← MSSQL connection pool
    │   ├── cert.js            ← Self-signed TLS cert generator
    │   ├── firewall.js        ← Windows Firewall rule manager (netsh)
    │   ├── logger.js          ← In-memory & console structured logger
    │   ├── install.js         ← Windows Service installation script
    │   ├── jtl/
    │   │   ├── jtl-server.js  ← Express router for JTL-POS protocol
    │   │   ├── pairing.js     ← Persistent pairing store (pairing.json)
    │   │   ├── cert-meta.js   ← Certificate fingerprint extraction
    │   │   ├── shop.js        ← Active shop resolution
    │   │   ├── image-handler.js ← Image streaming & resizing cache
    │   │   ├── image-resize.js ← Image dimension & aspect ratio helpers
    │   │   ├── endpoints/     ← All 14 JTL-POS protocol endpoints
    │   │   └── queries/       ← MSSQL queries & warehouse delivery engine
    │   └── routes/
    │       └── health.js      ← GET /api/health
    └── settings/
        ├── index.html         ← Settings dialog UI
        ├── settings.css       ← Dark-themed styles
        └── renderer.js        ← Settings UI logic
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop tray shell and settings GUI |
| `electron-store` | Local storage management |
| `express` | REST API framework for HTTP, HTTPS, and Named Pipe |
| `mssql` | High-performance MSSQL driver |
| `node-windows` | Windows Service registration and lifecycle control (`winsw`) |
| `selfsigned` | 2048-bit RSA self-signed TLS certificate generation |

---

## License

UNLICENSED — proprietary.

