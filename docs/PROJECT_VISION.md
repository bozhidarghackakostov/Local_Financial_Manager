# LedgerDesk — Project Vision & Requirements

## 1. Identity & Purpose

- **Product Name:** LedgerDesk — Private Finance Manager
- **Type:** Locally hosted personal finance management web application
- **Primary User:** Single individual managing personal finances on their own machine
- **Core Operating Principles:** Privacy, data ownership, mathematical reliability, simplicity, and 100% offline capability

LedgerDesk provides a single authoritative local system where a user can track accounts, record income/expenses/transfers, manage monthly category budgets, monitor recurring bills/income, track savings goals, analyze financial reports, import/export CSV and JSON data, and perform safe SQLite backups and restorations—without ever connecting to an external server or cloud service.

---

## 2. Core User Questions Answered

LedgerDesk is designed to answer the following questions immediately and accurately from local ledger records:

1. **How much money do I have?** — Total available balance across active accounts and per-account calculated balances.
2. **How much did I earn and spend in a given period?** — Period-filtered total income, total expenses, and net cash flow.
3. **Where is my money going?** — Spending by category and spending by account with exact minor-unit totals and percentages.
4. **Which bills and payments are coming up?** — Upcoming, due-soon, and overdue recurring occurrences awaiting confirmation.
5. **How much can I safely spend within my budget?** — Monthly category and overall budget limits, actual eligible spending, remaining budget, and overspending indicators.
6. **How much am I saving?** — Progress toward active savings goals, remaining target amounts, and contribution history.
7. **How has my financial position changed over time?** — Monthly cash flow trends and historical budget performance.
8. **Which accounts and categories account for most of my activity?** — Account movement breakdowns and category distribution tables/charts.

---

## 3. Non-Negotiable Constraints

1. **100% Local & Offline:** All financial records remain on the user's computer in a local SQLite database (`data/ledgerdesk.sqlite`). Zero cloud databases, zero external API calls, zero telemetry, zero external CDN assets (no Google Fonts, no external icon/script CDNs).
2. **Loopback Binding Only:** The HTTP server binds strictly to `127.0.0.1` by default so the application is not exposed to the local network.
3. **Authoritative Ledger Calculations:** Every dashboard metric, account balance, budget utilization figure, and report is dynamically computed from the underlying database records. No hardcoded or fabricated placeholder statistics in production views.
4. **Integer Minor Units:** All monetary values are stored, validated, and calculated in integer minor units (e.g., cents: `$10.50` = `1050`). Floating-point arithmetic is never used for authoritative financial sums.
5. **Recoverability & Auditability:** Transactions support soft deletion (trash) and restoration. Accounts and categories with history can be archived rather than destructively deleted unless reassigned. Full database backup and validated restore are built in.

---

## 4. Functional Scope Summary

| Module | Core Capabilities |
| :--- | :--- |
| **1. Dashboard** | Period selector (`this_month`, `last_month`, `last_30_days`, `last_90_days`, `this_year`, `custom`), total balance across active accounts, period income/expense/net cash flow, budget usage summary, upcoming recurring payments, savings goals progress, recent transactions, income-vs-expense chart, spending-by-category breakdown, and deep links to detailed views. |
| **2. Transactions** | Create, edit, view, duplicate, soft-delete (trash), and restore transactions (`income`, `expense`, `transfer`). Search by description/notes/tags, filter by type, account, category, status (active vs trashed), and date range. Sort by date, amount, account, category, or updated timestamp. Paginated ledger table with explicit `+`/`-`/`⇄` indicators and CSV export. |
| **3. Accounts** | Create, edit, and archive accounts (`cash`, `current`, `savings`, `credit_card`, `other`). Calculated current balance derived from `opening_balance_minor` + ledger movements. Per-account transaction history, inflow/outflow/net movement summary, and direct transfer action. Protection against deleting accounts with ledger history. |
| **4. Categories** | Separate `income` and `expense` categories with display ordering, optional parent category support, creation, editing, reordering, archiving, and safe deletion with transaction reassignment option. Manageable from Settings and accessible in transaction/budget forms. |
| **5. Budgets** | Monthly category budgets (`YYYY-MM` period) plus optional overall monthly target. Displays planned limit, actual eligible spending (excluding transfers and soft-deleted items, accounting for linked refunds), remaining amount, percentage used, overspending indicator, and historical comparison. |
| **6. Recurring Payments** | Recurring rules (`daily`, `weekly`, `monthly`, `yearly` with configurable interval) for income or expenses. Idempotent occurrence generation (`pending`, `confirmed`, `skipped`). Upcoming, due-soon, and overdue indicators. Explicit user confirmation posts a linked ledger transaction without duplicate generation across app restarts. |
| **7. Savings Goals** | Create, edit, complete, and archive savings goals with target amount, optional target date, description, and manual or transaction-linked contributions. Tracks current progress, remaining amount, percentage achieved, and contribution history without double-counting account balances. |
| **8. Reports** | Income vs expenses, spending by category, income by category, monthly cash flow, spending by account, budget performance, savings goal progress, and custom-period transaction history. Includes both visual charts and auditable data tables, plus CSV export for any report. |
| **9. Import, Export & Backup** | Multi-step CSV import (file selection, column mapping, date/amount parsing, validation preview, duplicate detection against existing ledger, user confirmation, and batch summary). Exports for transactions CSV, report CSV, and full structured JSON export. Safe SQLite online backup, backup history list, and validated atomic restoration. |
| **10. Settings** | Base currency configuration, date format preference, default dashboard period, category management, data export controls, and database backup/restore management. |
