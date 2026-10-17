# LedgerDesk — Privacy & Security Architecture

## 1. Local-First Privacy Guarantees

LedgerDesk is engineered so that personal financial data never leaves the user's machine:

1. **Zero Cloud or Third-Party Services:** No user registration, no telemetry, no analytics beacons, no crash reporters, and no remote banking APIs.
2. **Zero External Asset Requests:** All fonts (system font stack), CSS stylesheets, icons (inline SVGs), and JavaScript bundles are served from `127.0.0.1`. The application works identically when the computer's Wi-Fi and Ethernet interfaces are disabled.
3. **Loopback Network Binding:** By default, the Node.js HTTP server binds exclusively to `127.0.0.1` (`HOST=127.0.0.1`), making it unreachable from other devices on the local Wi-Fi or LAN.

---

## 2. HTTP & Browser Security Controls

Even a localhost server must defend against browser-based attacks (such as malicious websites visited in another browser tab attempting Cross-Site Request Forgery or DNS rebinding against `127.0.0.1`):

1. **Restrictive Content Security Policy (CSP):**
   ```text
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data:;
   font-src 'self';
   connect-src 'self';
   frame-ancestors 'none';
   base-uri 'self';
   form-action 'self';
   ```
2. **Host & Origin Verification Middleware:**
   - Validates that the `Host` header matches `127.0.0.1` or `localhost` (preventing DNS rebinding attacks where an attacker points `evil.example.com` to `127.0.0.1`).
   - For state-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`), if an `Origin` header is present, verifies that it originates from `http://127.0.0.1:*` or `http://localhost:*`. Requests from external origins are blocked with `403 Forbidden`.
3. **No Arbitrary CORS:**
   - Cross-origin resource sharing headers (`Access-Control-Allow-Origin: *`) are never emitted.

---

## 3. Filesystem Boundaries & Safe Backup/Restore

1. **Designated Data Directory:**
   - The active SQLite database is stored in `data/ledgerdesk.sqlite`.
   - Managed backups are stored in `data/backups/` with strict filename sanitization (`^[a-zA-Z0-9._-]+\.sqlite$`).
2. **Path Traversal Prevention:**
   - Backup download and restore endpoints never accept arbitrary filesystem paths from the client. When restoring from a managed backup filename, `path.basename()` and regex validation ensure the resolved path stays strictly inside `data/backups/`.
   - When restoring from an uploaded backup payload, the payload is written to a temporary file inside `data/backups/`, validated via SQLite `PRAGMA integrity_check` and schema verification (`schema_migrations`, `accounts`, `transactions` tables present), and only then atomically swapped in after creating a safety backup of the current database.
3. **Git Exclusion:**
   - `.gitignore` excludes `data/*.sqlite*`, `data/backups/*.sqlite*`, and any `.db` files so personal financial records cannot be accidentally committed to version control.

---

## 4. Logging & Error Handling Hygiene

- Routine request logging records only HTTP method, route path, status code, and duration.
- Transaction descriptions, notes, account names, and monetary amounts are **never** written to console logs.
- Unexpected internal errors return a generic message (`"An internal error occurred"`) to the client without exposing SQL queries, database file paths, or stack traces.

---

## 5. Honest Security Limitations

- **Unencrypted Local SQLite File in V1:** The database file `data/ledgerdesk.sqlite` and its `.sqlite` backups are stored as standard unencrypted SQLite files inside the local project directory.
- **OS Account Trust Model:** Any user or process with read access to the operating system user account can read `data/ledgerdesk.sqlite`. Users should rely on full-disk encryption (e.g., macOS FileVault, Linux LUKS, or Windows BitLocker) and operating-system account passwords to protect their machine at rest.
