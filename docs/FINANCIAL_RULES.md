# LedgerDesk — Financial Rules & Data Integrity Specification

This document is the authoritative specification for all monetary calculations in LedgerDesk. Every service and test must adhere strictly to these rules.

---

## 1. Monetary Representation & Conversion

1. **Integer Minor Units Only:**
   - All monetary values are stored in the database and processed in business logic as signed or unsigned 64-bit safe integers representing minor units of the base currency (e.g., 100 minor units = 1.00 major unit for standard 2-decimal currencies like USD, EUR, GBP).
   - Every transaction `amount_minor` is strictly positive (`amount_minor > 0`). Direction is determined by `transaction_type` and `is_refund`.
2. **Parsing User Input (`parseDecimalToMinorUnits`):**
   - Accepts strings matching optional sign, digits, and at most 2 decimal places (e.g., `"125"`, `"125.5"`, `"125.50"`, `"1,250.75"` after stripping thousands separators).
   - Rejects `NaN`, `Infinity`, empty strings, non-numeric characters, or inputs with more than 2 decimal places unless rounded by explicit half-up rule when converting external CSV percentages/rates. For direct monetary entry, more than 2 decimal places is rejected with a validation error so user input is never silently altered.
   - String-based exact parsing is used (`whole * 100 + fraction`) rather than `Math.round(parseFloat(val) * 100)` to eliminate IEEE 754 binary floating-point representation bugs (such as `19.99 * 100 = 1998.9999999999998`).
3. **Formatting Minor Units (`formatMinorUnits`):**
   - Converts integer minor units into major.minor format using integer division and modulo (`Math.trunc(abs / 100)` and `abs % 100` padded to 2 digits).

---

## 2. Account Balance Calculation

An account's current balance is never stored as a mutable column that gets incremented/decremented in isolation. It is always derived from `opening_balance_minor` plus all **active** (`deleted_at IS NULL`) transactions affecting that account:

$$\text{Balance}(A) = \text{OpeningBalance}(A) + \sum_{\text{tx} \in \text{Active}(A)} \Delta(\text{tx}, A)$$

Where $\Delta(\text{tx}, A)$ for an active transaction $\text{tx}$ is:
- **Income** (`transaction_type = 'income'`, `account_id = A`): $+\text{amount\_minor}$
- **Standard Expense** (`transaction_type = 'expense'`, `is_refund = 0`, `account_id = A`): $-\text{amount\_minor}$
- **Expense Refund** (`transaction_type = 'expense'`, `is_refund = 1`, `account_id = A`): $+\text{amount\_minor}$
- **Outbound Transfer** (`transaction_type = 'transfer'`, `account_id = A`): $-\text{amount\_minor}$
- **Inbound Transfer** (`transaction_type = 'transfer'`, `destination_account_id = A`): $+\text{amount\_minor}$

### Soft-Deleted Transactions
- Any transaction where `deleted_at IS NOT NULL` is completely excluded from account balances, income/expense totals, budgets, and reports.
- Restoring a soft-deleted transaction (`deleted_at = NULL`) immediately includes it again in all calculations.

### Total Available Balance (Dashboard)
- Sum of $\text{Balance}(A)$ across all **active** accounts (`status = 'active'`). Archived accounts remain in historical reports and the Accounts view (under Archived) with their full history intact.

---

## 3. Income, Expense, Refund, and Net Cash Flow Rules

For any selected date range $[D_{\text{start}}, D_{\text{end}}]$ (inclusive on `transaction_date` in `YYYY-MM-DD`):

1. **Gross Income:**
   $$\text{TotalIncome} = \sum \{ \text{amount\_minor} \mid \text{type} = \text{'income'}, \text{deleted\_at IS NULL}, D_{\text{start}} \le \text{date} \le D_{\text{end}} \}$$
2. **Net Expenses:**
   - Standard expenses (`type = 'expense'`, `is_refund = 0`) add $+\text{amount\_minor}$ to spending.
   - Expense refunds (`type = 'expense'`, `is_refund = 1`) subtract $-\text{amount\_minor}$ from spending in their assigned expense category (floored at 0 for visual percentage shares, while exact net total is shown in tables).
   $$\text{TotalExpenses} = \sum_{\text{expense, is\_refund=0}} \text{amount\_minor} - \sum_{\text{expense, is\_refund=1}} \text{amount\_minor}$$
3. **Transfers Excluded:**
   - Transactions with `transaction_type = 'transfer'` are **strictly excluded** from `TotalIncome`, `TotalExpenses`, `NetCashFlow`, category reports, and budgets.
   - A transfer between two active accounts preserves the combined balance across those accounts ($\Delta(A_{\text{source}}) + \Delta(A_{\text{dest}}) = 0$).
   - A transfer where `account_id == destination_account_id` is rejected by both service validation and SQLite `CHECK` constraint.
4. **Net Cash Flow:**
   $$\text{NetCashFlow} = \text{TotalIncome} - \text{TotalExpenses}$$

---

## 4. Calendar Date & Period Resolution Rules

- Transaction dates are stored as calendar strings `YYYY-MM-DD`.
- No timezone offset conversion is applied to `YYYY-MM-DD` strings; lexical comparison (`transaction_date >= startDate AND transaction_date <= endDate`) is both exact and index-friendly in SQLite.
- Supported named periods relative to a reference local date $T = \text{YYYY-MM-DD}$:
  - `this_month`: First day of $T$'s month (`YYYY-MM-01`) through last day of $T$'s month.
  - `last_month`: First day through last day of the calendar month preceding $T$.
  - `last_30_days`: $T - 29\text{ days}$ through $T$ (30 calendar days inclusive).
  - `last_90_days`: $T - 89\text{ days}$ through $T$ (90 calendar days inclusive).
  - `this_year`: `YYYY-01-01` through `YYYY-12-31`.
  - `custom`: User-supplied `startDate` and `endDate` (`startDate <= endDate`).

---

## 5. Budget Calculation Rules

Each budget is defined for a calendar month `period_month` (`YYYY-MM`) and either a specific expense `category_id` or `NULL` (representing an overall monthly spending budget).

1. **Eligible Transactions for a Budget in `YYYY-MM`:**
   - `deleted_at IS NULL`
   - `transaction_type = 'expense'`
   - `transaction_date` starts with `YYYY-MM` (i.e., `YYYY-MM-01` $\le \text{date} \le$ `YYYY-MM-31`). Transactions dated in future or past months outside `period_month` apply to their respective month's budget, not the current month.
   - If the budget targets a specific `category_id`, matches transactions in that category (or its child subcategories if nested). If the budget is an overall monthly budget (`category_id IS NULL`), matches all active expense transactions in `YYYY-MM`.
   - Transfers (`transaction_type = 'transfer'`) and Income (`transaction_type = 'income'`) are never counted in budgets.
2. **Actual Spending (`actual_minor`):**
   $$\text{actual\_minor} = \sum_{\text{standard expense}} \text{amount\_minor} - \sum_{\text{refund}} \text{amount\_minor}$$
3. **Remaining Budget (`remaining_minor`):**
   $$\text{remaining\_minor} = \text{planned\_amount\_minor} - \text{actual\_minor}$$
4. **Utilization Percentage (`percentage_used`):**
   $$\text{percentage\_used} = \text{round}\left(\frac{\max(0, \text{actual\_minor})}{\text{planned\_amount\_minor}} \times 10000\right) / 100$$
5. **Overspent Flag (`is_overspent`):**
   - `true` if and only if `actual_minor > planned_amount_minor`.

---

## 6. Recurring Payment & Occurrence Rules

1. **Rules Are Not Ledger Transactions:**
   - A `recurring_rule` defines a schedule (`daily`, `weekly`, `monthly`, `yearly` with `interval_count`). It never alters account balances directly.
2. **Idempotent Occurrence Materialization:**
   - When materializing occurrences up to a target horizon date (e.g., today + 30 days), the service calculates due dates starting from `start_date` (or `next_due_date`) up to `min(end_date, horizon_date)`.
   - `INSERT OR IGNORE INTO recurring_occurrences (recurring_rule_id, due_date, ...)` combined with `UNIQUE(recurring_rule_id, due_date)` ensures that inspecting or launching the app 1 time or 1,000 times produces the exact same occurrence rows.
3. **Confirming a Payment:**
   - Confirming a `pending` occurrence executes inside a single SQLite transaction:
     1. Verifies the occurrence status is not already `confirmed`.
     2. Creates a real `transactions` record (`income` or `expense`) using the occurrence date (or user-specified payment date) and amount.
     3. Updates the occurrence to `status = 'confirmed'` and sets `linked_transaction_id` to the newly created transaction ID.
   - Attempting to confirm an already-confirmed occurrence is rejected with a `ConflictError` (`409`), preventing duplicate ledger postings.

---

## 7. Savings Goal Accounting Rules

1. **Source of Truth for Goal Progress:**
   - A savings goal's `current_amount_minor` is the exact sum of all `amount_minor` records in `savings_contributions` for that `goal_id`.
2. **No Double Deduction of Account Balances:**
   - Recording a savings contribution adds a tracking allocation record in `savings_contributions`. It does **not** secretly subtract money from an account balance.
   - Users may optionally link a contribution to an existing transaction (such as a transfer into their Savings Account) for reference, or record standalone goal allocations. Account balances remain strictly governed by the `transactions` table (Section 2).
3. **Goal Metrics:**
   - `current_amount_minor = COALESCE(SUM(amount_minor), 0)`
   - `remaining_amount_minor = MAX(0, target_amount_minor - current_amount_minor)`
   - `percentage_achieved = round(( clamp(current_amount_minor, 0, target_amount_minor) / target_amount_minor ) * 10000) / 100` (with total percentage also exposed if over 100%).
