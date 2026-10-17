# LedgerDesk — Test Plan & Verification Matrix

## 1. Testing Strategy

LedgerDesk enforces financial correctness and system reliability across four automated test layers executed via **Vitest**:

1. **Unit Tests (`tests/unit/`):**
   - Exact decimal-to-minor-unit conversion (`parseDecimalToMinorUnits`) and formatting (`formatMinorUnits`).
   - Calendar date arithmetic, month boundary handling, and period resolution (`dates.ts`).
   - Pure financial domain rules and validation logic.
2. **Integration Tests (`tests/integration/`):**
   - Database initialization, deterministic migration execution, idempotency of migrations, and foreign-key enforcement.
   - Multi-service workflows against real SQLite instances.
   - Mandatory Financial Scenarios A through G.
3. **API Tests (`tests/api/`):**
   - End-to-end HTTP request/response validation via `supertest` across `/api/health`, `/api/settings`, `/api/accounts`, `/api/categories`, `/api/transactions`, `/api/budgets`, `/api/recurring`, `/api/goals`, `/api/dashboard`, `/api/reports`, `/api/imports`, `/api/export`, and `/api/backup`.
   - Security middleware verification (cross-origin rejection, malformed input rejection, SQL error hiding).
4. **UI Tests (`tests/ui/`):**
   - Component and full-app navigation tests using React Testing Library and `jsdom`.
   - Empty states, form validation feedback, transaction creation/filtering, confirmation modals, and settings actions.

---

## 2. Mandatory Financial Test Scenarios

| Scenario | Description | Expected Verification |
| :--- | :--- | :--- |
| **Scenario A — Income** | Account opening balance `1,000.00` (`100000`), record income `500.00` (`50000`). | Account balance equals `1,500.00` (`150000`); period income equals `500.00`. |
| **Scenario B — Expense** | Account opening balance `1,000.00` (`100000`), record expense `120.00` (`12000`). | Account balance equals `880.00` (`88000`); period expense equals `120.00`. |
| **Scenario C — Transfer** | Account A opening `1,000.00`, Account B opening `200.00`. Transfer `250.00` from A to B. | Account A balance = `750.00`, Account B balance = `450.00`, combined balance = `1,200.00`. Period income = `0.00`, period expense = `0.00`. Self-transfer (`A -> A`) is rejected. |
| **Scenario D — Historical Editing** | Record expense in `2026-09`, then edit `transaction_date` to `2026-10` (and test soft-delete/restore). | `2026-09` report and budget actuals decrease to `0.00`; `2026-10` report and budget actuals reflect the updated expense immediately. |
| **Scenario E — Recurrence Idempotency** | Create a recurring rule and invoke occurrence generation multiple times for the same horizon. Confirm an occurrence once, then attempt a second confirmation. | Exactly one occurrence per due date is created. Confirming posts one ledger transaction and marks occurrence `confirmed`. Second confirmation is rejected (`409`). |
| **Scenario F — Import Safety** | Preview a CSV containing valid rows, invalid rows (bad date/amount), and probable duplicates matching existing ledger transactions. | Preview identifies valid, invalid, and duplicate rows without writing to the database. Committing imports only the confirmed valid rows and skips unconfirmed duplicates/invalid rows. |
| **Scenario G — Backup & Restoration** | Populate accounts, categories, transactions, budgets, goals, and settings. Create a SQLite backup, modify/delete data, then restore from backup. Test restoring a corrupted/invalid file. | Valid restore recovers exact pre-mutation state across all tables. Corrupted restore is rejected prior to overwriting and leaves existing database intact. |
