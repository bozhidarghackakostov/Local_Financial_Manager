# LedgerDesk — Implementation Plan & Roadmap

## Phase 0 — Requirements and Architecture (Completed)
- Inspect workspace and runtime environment (Node v26 with native `node:sqlite`).
- Deliver complete technical documentation in `docs/`:
  - `PROJECT_VISION.md`
  - `ARCHITECTURE.md`
  - `DATA_MODEL.md`
  - `FINANCIAL_RULES.md`
  - `PRIVACY_AND_SECURITY.md`
  - `IMPLEMENTATION_PLAN.md`
  - `TEST_PLAN.md`

## Phase 1 — Project Foundation
- Initialize `package.json`, `tsconfig.json`, `vite.config.ts`, and `.gitignore`.
- Implement shared utilities (`money.ts`, `dates.ts`), types, and schemas.
- Implement SQLite connection (`src/server/db/connection.ts`), deterministic migration runner (`src/server/db/migrator.ts`), initial schema (`database/migrations/001_initial_schema.sql`), and default category/settings seeding.
- Implement Express server bound to `127.0.0.1`, security/origin middleware, error handling, `/api/health`, and `/api/settings`.
- Implement React application shell, sidebar navigation, shared reusable UI components, and Settings view.

## Phase 2 — Accounts, Categories and Transactions
- Implement `AccountRepository` and `AccountService` (CRUD, archive, calculated balance, account summary, deletion protection).
- Implement `CategoryRepository` and `CategoryService` (CRUD, ordering, archive, safe reassignment on delete).
- Implement `TransactionRepository` and `TransactionService` (income, expense, refund, atomic transfer, soft delete to trash, restore, duplicate, filters, sorting, pagination, tags).
- Implement API routes and Frontend UI views for Accounts, Categories, and Transactions.

## Phase 3 — Dashboard and Reports
- Implement `ReportService` providing:
  - Period resolution (`this_month`, `last_month`, `last_30_days`, `last_90_days`, `this_year`, `custom`)
  - Dashboard summary (total balance, period income, expenses, net cash flow, recent transactions, budget usage, upcoming recurring items, savings progress, income-vs-expense series, category breakdown)
  - Dedicated report endpoints (cash flow by month, spending by category, income by category, spending by account, budget performance, savings progress, custom period transaction history, and CSV report export)
- Implement Frontend Dashboard and Reports views with interactive SVG charts and auditable tables.

## Phase 4 — Budgets and Recurring Payments
- Implement `BudgetRepository` and `BudgetService` (monthly category & overall budgets, actual spending with refund handling and transfer exclusion, historical budget comparison).
- Implement `RecurringRepository` and `RecurringService` (schedules, idempotent occurrence generation, due-soon/overdue states, pause/resume/cancel, atomic payment confirmation).
- Implement API routes and Frontend UI views for Budgets and Recurring Payments.

## Phase 5 — Savings Goals
- Implement `GoalRepository` and `GoalService` (goal CRUD, status lifecycle, manual and linked contributions, progress metrics).
- Implement API routes and Frontend UI view for Savings Goals.

## Phase 6 — Import, Export and Recovery
- Implement `ImportExportService` (CSV parsing with configurable delimiter/date format/column mapping, row validation preview, duplicate detection against existing ledger, user-confirmed commit, transactions CSV export, full structured JSON export).
- Implement `BackupService` (SQLite online backup creation, backup history listing, backup integrity check, atomic restore with automatic safety snapshot, and JSON data import/restore).
- Implement API routes and Frontend UI controls in Transactions, Reports, and Settings.

## Phase 7 — Security, Reliability and Polish
- Verify CSP, host/origin security protections, and zero external network dependencies.
- Execute full unit, integration, API, and UI test suites covering all mandatory financial scenarios (Scenarios A–G).
- Complete comprehensive `README.md` with installation, startup, backup, and recovery instructions.
