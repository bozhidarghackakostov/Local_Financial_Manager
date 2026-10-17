# LedgerDesk — Private Offline Finance Manager

LedgerDesk is a local-first, 100% offline personal finance management web application. It runs entirely on your own computer, binds exclusively to loopback (`127.0.0.1`), and persists all financial records in a local SQLite database (`data/ledgerdesk.sqlite`).

---

## Core Guarantees

- **100% Local & Offline:** No cloud accounts, no remote databases, no banking APIs, no telemetry, and no external CDN requests (no external fonts, icons, or scripts).
- **Loopback Network Boundary:** Binds strictly to `127.0.0.1` by default, with Content Security Policy (CSP), DNS-rebinding `Host` verification, and cross-origin request protection.
- **Exact Financial Arithmetic:** All monetary values are stored and calculated in integer minor units (e.g., cents: `$10.50` = `1050`). IEEE 754 floating-point arithmetic is never used for authoritative balances or reports.
- **Ledger-Derived Balances:** Account balances, budget utilization, and financial reports are dynamically computed and reconcilable from the underlying transaction ledger.
- **Data Ownership & Recoverability:** Supports soft-deletion (Trash) and restoration for transactions, CSV import with preview & duplicate detection, CSV and structured JSON exports, and verified SQLite online backups and atomic restorations.

---

## Quick Start

### Option A: One-Click macOS Launcher (Recommended)
Double-click **`Start-LedgerDesk.command`** in Finder (or run `./Start-LedgerDesk.command` in Terminal).
- It automatically starts the local backend & UI server on `http://127.0.0.1:3001` (or detects if it is already running) and opens your default browser.

### Option B: Terminal Commands

#### Prerequisites
- **Node.js** v22.5+ or v26+ (uses Node's built-in `node:sqlite` module — no native C++ compilation required)
- **npm** v10+

#### 1. Start the Local Server & Web App
```bash
npm start
```
Then open **`http://127.0.0.1:3001`** in your web browser.

### 3. Development Mode (Hot Reload)
Run the local backend API (`127.0.0.1:3001`) and Vite frontend (`127.0.0.1:5173`):
```bash
npm run dev:server
# In a second terminal:
npm run dev:client
```

---

## Running Tests & Verification

```bash
# Run the complete unit, integration, API, and UI test suite
npm test

# Run TypeScript static typechecking
npm run typecheck
```

---

## Database Storage, Backup & Recovery Instructions

### Where Your Data Lives
- **Active Database:** `data/ledgerdesk.sqlite` (override via `LEDGERDESK_DB_PATH` environment variable)
- **Managed Backups:** `data/backups/*.sqlite` (override via `LEDGERDESK_BACKUPS_DIR` environment variable)

Both `data/*.sqlite` and `data/backups/*.sqlite` are excluded in `.gitignore` so personal financial records are never committed to Git.

### Creating a Backup
1. Open **Settings → SQLite Database Backup & Recovery** in the LedgerDesk UI and click **"+ Create Database Backup Now"**, or call:
   ```bash
   curl -X POST http://127.0.0.1:3001/api/backup -H "Content-Type: application/json" -d '{"label":"manual"}'
   ```
2. LedgerDesk uses SQLite's online backup API (`node:sqlite` `backup()`) and immediately verifies the backup file with `PRAGMA integrity_check` and table schema checks.
3. You can also download `.sqlite` backup files, **Transactions CSV** (`/api/export/transactions.csv`), and **Full Structured JSON** (`/api/export/full.json`) directly from the Settings page.

### Restoring from a Backup
1. In **Settings → SQLite Database Backup & Recovery**, click **"Restore This Backup"** next to any listed backup, or upload an external `.sqlite` backup file.
2. Before replacing the active database, LedgerDesk:
   - Validates the candidate backup file (`SQLite format 3` header, `PRAGMA integrity_check`, and required tables).
   - Creates an automatic pre-restore safety snapshot (`ledgerdesk-pre-restore-safety-<timestamp>.sqlite`) in `data/backups/`.
   - Atomically replaces `data/ledgerdesk.sqlite` and reopens the SQLite connection without requiring a server restart.
3. If a backup file is invalid or corrupted, the restore is aborted before touching your active database.

---

## Documentation Index

Detailed specifications are located in the [`docs/`](./docs/) directory:
- [`docs/PROJECT_VISION.md`](./docs/PROJECT_VISION.md) — Product requirements and functional scope
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Technical architecture and layered design
- [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) — SQLite schema, constraints, and indexes
- [`docs/FINANCIAL_RULES.md`](./docs/FINANCIAL_RULES.md) — Authoritative money, balance, transfer, refund, budget, recurring, and goal formulas
- [`docs/PRIVACY_AND_SECURITY.md`](./docs/PRIVACY_AND_SECURITY.md) — Loopback boundary, CSP, origin validation, and filesystem protections
- [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — Phased implementation roadmap
- [`docs/TEST_PLAN.md`](./docs/TEST_PLAN.md) — Automated test matrix and mandatory financial scenarios (A–G)
