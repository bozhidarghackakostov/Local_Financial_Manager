import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServices, type ServicesContainer } from '../../src/server/app.ts';
import { runMigrations } from '../../src/server/db/migrator.ts';
import { ConflictError, ValidationError } from '../../src/server/errors/index.ts';

describe('Mandatory Financial Scenarios & Database Integrity (Scenarios A–G)', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupsDir: string;
  let services: ServicesContainer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerdesk-test-'));
    dbPath = path.join(tmpDir, 'test.sqlite');
    backupsDir = path.join(tmpDir, 'backups');
    services = createServices({ dbPath, backupsDir });
  });

  afterEach(() => {
    services.dbManager.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs migrations deterministically and idempotently', () => {
    const secondRun = runMigrations(services.dbManager);
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.totalApplied).toBeGreaterThanOrEqual(1);
    const categories = services.categoryService.listCategories();
    expect(categories.length).toBeGreaterThanOrEqual(15);
  });

  it('Scenario A — Income increases account balance and contributes to income totals', () => {
    // Opening account balance: 1,000.00 (100000 minor units)
    const account = services.accountService.createAccount({
      name: 'Main Checking',
      account_type: 'current',
      opening_balance_minor: 100000,
    });
    expect(account.current_balance_minor).toBe(100000);

    // Income: 500.00 (50000 minor units)
    services.transactionService.createTransaction({
      transaction_type: 'income',
      transaction_date: '2026-10-10',
      amount_minor: 50000,
      account_id: account.id,
      category_id: 'cat-inc-salary',
      description: 'Monthly Payroll',
    });

    // Expected balance: 1,500.00 (150000 minor units)
    const updatedAccount = services.accountService.getAccountById(account.id);
    expect(updatedAccount.current_balance_minor).toBe(150000);
    expect(updatedAccount.inflow_minor).toBe(50000);
    expect(updatedAccount.outflow_minor).toBe(0);

    const summary = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    expect(summary.total_balance_minor).toBe(150000);
    expect(summary.period_income_minor).toBe(50000);
    expect(summary.period_expense_minor).toBe(0);
    expect(summary.net_cash_flow_minor).toBe(50000);
  });

  it('Scenario B — Expense decreases account balance and contributes to expense & budget totals (plus refund verification)', () => {
    // Opening account balance: 1,000.00 (100000)
    const account = services.accountService.createAccount({
      name: 'Household Account',
      account_type: 'current',
      opening_balance_minor: 100000,
    });

    // Expense: 120.00 (12000)
    const expenseTx = services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-12',
      amount_minor: 12000,
      account_id: account.id,
      category_id: 'cat-exp-groceries',
      description: 'Supermarket',
    });

    // Expected balance: 880.00 (88000)
    const updatedAccount = services.accountService.getAccountById(account.id);
    expect(updatedAccount.current_balance_minor).toBe(88000);

    const summary = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    expect(summary.period_expense_minor).toBe(12000);
    expect(summary.net_cash_flow_minor).toBe(-12000);

    // Record a linked refund of 20.00 (2000)
    services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-13',
      amount_minor: 2000,
      account_id: account.id,
      category_id: 'cat-exp-groceries',
      description: 'Supermarket Refund',
      is_refund: true,
      refunded_transaction_id: expenseTx.id,
    });

    // Balance becomes 900.00 (90000) and net expense in groceries becomes 100.00 (10000)
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(90000);
    const afterRefundSummary = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    expect(afterRefundSummary.period_expense_minor).toBe(10000);
  });

  it('Scenario C — Transfer preserves combined balance and is excluded from income, expenses, and budgets', () => {
    // Account A opening balance: 1,000.00 (100000)
    const accountA = services.accountService.createAccount({
      name: 'Account A',
      account_type: 'current',
      opening_balance_minor: 100000,
    });
    // Account B opening balance: 200.00 (20000)
    const accountB = services.accountService.createAccount({
      name: 'Account B',
      account_type: 'savings',
      opening_balance_minor: 20000,
    });

    // Create a monthly overall budget to verify transfers do not count toward spending
    const budget = services.budgetService.createBudget({
      name: 'October Total Budget',
      category_id: null,
      period_month: '2026-10',
      planned_amount_minor: 50000,
    });

    // Transfer 250.00 (25000) from A to B
    services.transactionService.createTransaction({
      transaction_type: 'transfer',
      transaction_date: '2026-10-14',
      amount_minor: 25000,
      account_id: accountA.id,
      destination_account_id: accountB.id,
      description: 'Savings Transfer',
    });

    const updatedA = services.accountService.getAccountById(accountA.id);
    const updatedB = services.accountService.getAccountById(accountB.id);

    // Expected A balance: 750.00 (75000)
    expect(updatedA.current_balance_minor).toBe(75000);
    // Expected B balance: 450.00 (45000)
    expect(updatedB.current_balance_minor).toBe(45000);
    // Expected combined balance: 1,200.00 (120000)
    expect(updatedA.current_balance_minor + updatedB.current_balance_minor).toBe(120000);

    // Transfer must not appear as income or expense
    const summary = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    expect(summary.total_balance_minor).toBe(120000);
    expect(summary.period_income_minor).toBe(0);
    expect(summary.period_expense_minor).toBe(0);
    expect(summary.net_cash_flow_minor).toBe(0);

    // Transfer must not affect budget spending
    const updatedBudget = services.budgetService.getBudgetById(budget.id);
    expect(updatedBudget.actual_minor).toBe(0);

    // Self-transfer must be rejected
    expect(() =>
      services.transactionService.createTransaction({
        transaction_type: 'transfer',
        transaction_date: '2026-10-14',
        amount_minor: 1000,
        account_id: accountA.id,
        destination_account_id: accountA.id,
      })
    ).toThrow(ValidationError);
  });

  it('Scenario D — Historical editing and soft-deletion/restoration update affected monthly reports and budgets', () => {
    const account = services.accountService.createAccount({
      name: 'Card Account',
      account_type: 'credit_card',
      opening_balance_minor: 0,
    });

    const septBudget = services.budgetService.createBudget({
      name: 'Sept Utilities',
      category_id: 'cat-exp-utilities',
      period_month: '2026-09',
      planned_amount_minor: 20000,
    });
    const octBudget = services.budgetService.createBudget({
      name: 'Oct Utilities',
      category_id: 'cat-exp-utilities',
      period_month: '2026-10',
      planned_amount_minor: 20000,
    });

    // Create expense of 150.00 in September (2026-09-20)
    const tx = services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-09-20',
      amount_minor: 15000,
      account_id: account.id,
      category_id: 'cat-exp-utilities',
      description: 'Electric Bill',
    });

    expect(services.budgetService.getBudgetById(septBudget.id).actual_minor).toBe(15000);
    expect(services.budgetService.getBudgetById(octBudget.id).actual_minor).toBe(0);

    // Edit transaction date to October (2026-10-05)
    services.transactionService.updateTransaction(tx.id, {
      transaction_date: '2026-10-05',
    });

    // Verify both months' budgets and reports update immediately
    expect(services.budgetService.getBudgetById(septBudget.id).actual_minor).toBe(0);
    expect(services.budgetService.getBudgetById(octBudget.id).actual_minor).toBe(15000);

    const septTotals = services.reportService.getIncomeAndExpenseTotals({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    const octTotals = services.reportService.getIncomeAndExpenseTotals({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(septTotals.expense_minor).toBe(0);
    expect(octTotals.expense_minor).toBe(15000);

    // Soft-delete transaction and verify balance/budget revert to 0
    services.transactionService.deleteTransaction(tx.id);
    expect(services.budgetService.getBudgetById(octBudget.id).actual_minor).toBe(0);
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(0);

    // Restore transaction and verify balance/budget include it again
    services.transactionService.restoreTransaction(tx.id);
    expect(services.budgetService.getBudgetById(octBudget.id).actual_minor).toBe(15000);
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(-15000);
  });

  it('Scenario E — Recurrence idempotency and single-posting confirmation protection', () => {
    const account = services.accountService.createAccount({
      name: 'Bills Account',
      account_type: 'current',
      opening_balance_minor: 200000,
    });

    const rule = services.recurringService.createRule(
      {
        name: 'Apartment Rent',
        transaction_type: 'expense',
        amount_minor: 120000,
        account_id: account.id,
        category_id: 'cat-exp-housing',
        frequency: 'monthly',
        interval_count: 1,
        start_date: '2026-09-01',
      },
      '2026-10-17'
    );

    // Materialize multiple times for the same period
    services.recurringService.materializeOccurrences('2026-10-17');
    services.recurringService.materializeOccurrences('2026-10-17');
    services.recurringService.materializeOccurrences('2026-10-17');

    const occurrences = services.recurringService.listOccurrences({
      ruleId: rule.id,
      referenceDate: '2026-10-17',
    });

    // Should have exactly 2026-09-01, 2026-10-01, 2026-11-01 (within 35-day horizon of 2026-10-17)
    const dueDates = occurrences.map((o) => o.due_date);
    expect(dueDates).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);

    // Account balance is untouched before user confirmation
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(200000);

    // Confirm first occurrence
    const firstOcc = occurrences[0];
    const confirmed = services.recurringService.confirmOccurrence(firstOcc.id, {}, '2026-10-17');
    expect(confirmed.occurrence.status).toBe('confirmed');
    expect(confirmed.transaction.amount_minor).toBe(120000);
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(80000);

    // Attempting to confirm the same occurrence a second time must throw ConflictError
    expect(() =>
      services.recurringService.confirmOccurrence(firstOcc.id, {}, '2026-10-17')
    ).toThrow(ConflictError);
  });

  it('Scenario F — CSV Import preview validation, duplicate detection, and safe user-confirmed commit', () => {
    const account = services.accountService.createAccount({
      name: 'Import Checking',
      account_type: 'current',
      opening_balance_minor: 50000,
    });

    // Seed an existing transaction that will match one of the CSV rows
    services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-05',
      amount_minor: 4500,
      account_id: account.id,
      category_id: 'cat-exp-groceries',
      description: 'Local Market',
    });

    const csvContent = [
      'Date,Amount,Description,Category',
      '2026-10-05,-45.00,Local Market,Groceries', // Probable duplicate
      '2026-10-06,-25.50,City Bakery,Restaurants', // Valid new expense
      '2026-10-07,1500.00,Client Invoice,Freelance', // Valid new income
      'invalid-date,-10.00,Broken Row,Groceries', // Invalid date
      '2026-10-08,not-a-number,Broken Amount,Groceries', // Invalid amount
    ].join('\n');

    const preview = services.importExportService.previewCsvImport({
      csvContent,
      accountId: account.id,
      delimiter: ',',
      mapping: {
        dateColumn: 'Date',
        amountColumn: 'Amount',
        descriptionColumn: 'Description',
        categoryColumn: 'Category',
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
      },
    });

    expect(preview.totalRows).toBe(5);
    expect(preview.validCount).toBe(3);
    expect(preview.invalidCount).toBe(2);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[0].isProbableDuplicate).toBe(true);
    expect(preview.rows[3].valid).toBe(false);
    expect(preview.rows[4].valid).toBe(false);

    // Verify preview did NOT alter the database
    expect(services.transactionService.listTransactions({ accountId: account.id }).total).toBe(1);

    // Commit valid rows while skipping duplicates (includeDuplicates: false)
    const validParsedRows = preview.rows
      .filter((r) => r.valid && r.parsed)
      .map((r) => ({
        rowIndex: r.rowIndex,
        skip: false,
        isProbableDuplicate: r.isProbableDuplicate,
        ...r.parsed!,
      }));

    const commitRes = services.importExportService.commitCsvImport({
      sourceFilename: 'statement.csv',
      accountId: account.id,
      includeDuplicates: false,
      rows: validParsedRows,
    });

    expect(commitRes.importedCount).toBe(2); // Bakery + Client Invoice
    expect(commitRes.skippedCount).toBe(1); // Duplicate Local Market skipped
    expect(services.transactionService.listTransactions({ accountId: account.id }).total).toBe(3);
  });

  it('Scenario G — Backup and restoration preserves data and rejects corrupted backup files safely', async () => {
    services.settingsService.updateSettings({ base_currency: 'EUR' });
    const account = services.accountService.createAccount({
      name: 'Vault Savings',
      account_type: 'savings',
      opening_balance_minor: 500000,
    });
    services.transactionService.createTransaction({
      transaction_type: 'income',
      transaction_date: '2026-10-01',
      amount_minor: 100000,
      account_id: account.id,
      category_id: 'cat-inc-salary',
      description: 'Bonus',
    });
    const goal = services.goalService.createGoal({
      name: 'Emergency Fund',
      target_amount_minor: 1000000,
      initial_contribution_minor: 200000,
    });

    // Create backup when balance is 6,000.00 (600000)
    const backupMeta = await services.backupService.createBackup('milestone');
    expect(backupMeta.filename).toContain('milestone');
    expect(backupMeta.sizeBytes).toBeGreaterThan(4096);

    // Mutate database after backup: add an expense and change currency
    services.settingsService.updateSettings({ base_currency: 'GBP' });
    services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-15',
      amount_minor: 300000,
      account_id: account.id,
      category_id: 'cat-exp-shopping',
      description: 'Post-backup purchase',
    });
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(300000);

    // Attempt to restore a corrupted file first and verify live data is NOT destroyed
    const corruptBase64 = Buffer.from('NOT A VALID SQLITE FILE AT ALL').toString('base64');
    await expect(
      services.backupService.restoreFromUploadedBase64(corruptBase64, 'corrupt.sqlite')
    ).rejects.toThrow(ValidationError);

    // Live data after failed restore is still intact (balance 300000, GBP)
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(300000);
    expect(services.settingsService.getSettings().base_currency).toBe('GBP');

    // Now restore the valid backup
    const restoreRes = await services.backupService.restoreFromBackupFilename(backupMeta.filename);
    expect(restoreRes.restoredFrom).toBe(backupMeta.filename);

    // Verify all records, balances, goals, and settings match the backup snapshot
    expect(services.settingsService.getSettings().base_currency).toBe('EUR');
    expect(services.accountService.getAccountById(account.id).current_balance_minor).toBe(600000);
    expect(services.goalService.getGoalById(goal.id).current_amount_minor).toBe(200000);
  });
});
