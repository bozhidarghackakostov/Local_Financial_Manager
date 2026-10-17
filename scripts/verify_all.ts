import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createServices, createApp } from '../src/server/app.ts';
import { runMigrations } from '../src/server/db/migrator.ts';
import { ConflictError, ValidationError } from '../src/server/errors/index.ts';
import {
  parseDecimalToMinorUnits,
  minorUnitsToDecimalString,
  formatMinorUnits,
  calculatePercentage,
} from '../src/shared/utils/money.ts';
import {
  isValidIsoDate,
  addCalendarDays,
  addCalendarMonths,
  advanceRecurringDate,
  resolvePeriodRange,
  parseExternalDateToIso,
  formatDisplayDate,
} from '../src/shared/utils/dates.ts';

async function runVerification() {
  console.log('1. Verifying minor-unit money & calendar date utilities...');
  assert.equal(parseDecimalToMinorUnits('1000.00'), 100000);
  assert.equal(parseDecimalToMinorUnits('19.99'), 1999);
  assert.equal(parseDecimalToMinorUnits('1,250.75'), 125075);
  assert.equal(parseDecimalToMinorUnits('1.250,75', { decimalSeparator: ',' }), 125075);
  assert.equal(minorUnitsToDecimalString(150000), '1500.00');
  assert.equal(minorUnitsToDecimalString(-12050), '-120.50');
  assert.equal(formatMinorUnits(150000, 'USD'), '$1,500.00');
  assert.equal(calculatePercentage(5000, 10000), 50);
  assert.equal(calculatePercentage(3333, 10000), 33.33);

  assert.equal(isValidIsoDate('2026-10-17'), true);
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(advanceRecurringDate('2026-01-15', 'monthly', 1), '2026-02-15');
  assert.deepEqual(resolvePeriodRange('this_month', '2026-10-17'), {
    preset: 'this_month',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.equal(parseExternalDateToIso('17/10/2026', 'DD/MM/YYYY'), '2026-10-17');
  assert.equal(formatDisplayDate('2026-10-17', 'DD/MM/YYYY'), '17/10/2026');
  console.log('   ✓ Money & date utilities passed.');

  console.log('2. Verifying Mandatory Financial Scenarios A–G...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerdesk-verify-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const backupsDir = path.join(tmpDir, 'backups');
  const services = createServices({ dbPath, backupsDir });

  try {
    // Idempotent migrations check
    const secondRun = runMigrations(services.dbManager);
    assert.deepEqual(secondRun.applied, []);
    assert.ok(services.categoryService.listCategories().length >= 15);

    // Scenario A — Income increases account balance and contributes to income totals
    const accountA = services.accountService.createAccount({
      name: 'Main Checking',
      account_type: 'current',
      opening_balance_minor: 100000,
    });
    assert.equal(accountA.current_balance_minor, 100000);

    services.transactionService.createTransaction({
      transaction_type: 'income',
      transaction_date: '2026-10-10',
      amount_minor: 50000,
      account_id: accountA.id,
      category_id: 'cat-inc-salary',
      description: 'Monthly Payroll',
    });
    assert.equal(services.accountService.getAccountById(accountA.id).current_balance_minor, 150000);

    // Scenario B — Expense decreases account balance & refund reduces net expense
    const expenseTx = services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-12',
      amount_minor: 12000,
      account_id: accountA.id,
      category_id: 'cat-exp-groceries',
      description: 'Supermarket',
    });
    assert.equal(services.accountService.getAccountById(accountA.id).current_balance_minor, 138000);

    services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-13',
      amount_minor: 2000,
      account_id: accountA.id,
      category_id: 'cat-exp-groceries',
      description: 'Supermarket Refund',
      is_refund: true,
      refunded_transaction_id: expenseTx.id,
    });
    assert.equal(services.accountService.getAccountById(accountA.id).current_balance_minor, 140000);

    const summaryAfterRefund = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    assert.equal(summaryAfterRefund.period_income_minor, 50000);
    assert.equal(summaryAfterRefund.period_expense_minor, 10000);
    assert.equal(summaryAfterRefund.net_cash_flow_minor, 40000);

    // Scenario C — Transfer preserves combined balance and is excluded from income/expense/budgets
    const accountB = services.accountService.createAccount({
      name: 'Savings Account',
      account_type: 'savings',
      opening_balance_minor: 20000,
    });
    const budget = services.budgetService.createBudget({
      name: 'October Groceries Budget',
      category_id: 'cat-exp-groceries',
      period_month: '2026-10',
      planned_amount_minor: 50000,
    });
    assert.equal(budget.actual_minor, 10000);

    services.transactionService.createTransaction({
      transaction_type: 'transfer',
      transaction_date: '2026-10-14',
      amount_minor: 25000,
      account_id: accountA.id,
      destination_account_id: accountB.id,
      description: 'Savings Transfer',
    });
    assert.equal(services.accountService.getAccountById(accountA.id).current_balance_minor, 115000);
    assert.equal(services.accountService.getAccountById(accountB.id).current_balance_minor, 45000);

    const summaryAfterTransfer = services.reportService.getDashboardSummary({
      preset: 'this_month',
      referenceDate: '2026-10-17',
    });
    assert.equal(summaryAfterTransfer.total_balance_minor, 160000);
    assert.equal(summaryAfterTransfer.period_income_minor, 50000);
    assert.equal(summaryAfterTransfer.period_expense_minor, 10000);

    // Self-transfer rejected
    assert.throws(
      () =>
        services.transactionService.createTransaction({
          transaction_type: 'transfer',
          transaction_date: '2026-10-14',
          amount_minor: 1000,
          account_id: accountA.id,
          destination_account_id: accountA.id,
        }),
      ValidationError
    );

    // Scenario D — Historical editing and soft-deletion/restoration
    const utilTx = services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-09-20',
      amount_minor: 15000,
      account_id: accountA.id,
      category_id: 'cat-exp-utilities',
      description: 'Electric Bill',
    });
    services.transactionService.updateTransaction(utilTx.id, {
      transaction_date: '2026-10-05',
    });
    assert.equal(
      services.reportService.getIncomeAndExpenseTotals({
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }).expense_minor,
      0
    );
    assert.equal(
      services.reportService.getIncomeAndExpenseTotals({
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      }).expense_minor,
      25000
    );

    services.transactionService.deleteTransaction(utilTx.id);
    assert.equal(
      services.reportService.getIncomeAndExpenseTotals({
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      }).expense_minor,
      10000
    );
    services.transactionService.restoreTransaction(utilTx.id);
    assert.equal(
      services.reportService.getIncomeAndExpenseTotals({
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      }).expense_minor,
      25000
    );

    // Scenario E — Recurrence idempotency and single-posting confirmation protection
    const rule = services.recurringService.createRule(
      {
        name: 'Apartment Rent',
        transaction_type: 'expense',
        amount_minor: 120000,
        account_id: accountA.id,
        category_id: 'cat-exp-housing',
        frequency: 'monthly',
        interval_count: 1,
        start_date: '2026-09-01',
      },
      '2026-10-17'
    );
    services.recurringService.materializeOccurrences('2026-10-17');
    services.recurringService.materializeOccurrences('2026-10-17');
    const occurrences = services.recurringService.listOccurrences({
      ruleId: rule.id,
      referenceDate: '2026-10-17',
    });
    assert.deepEqual(
      occurrences.map((o) => o.due_date),
      ['2026-09-01', '2026-10-01', '2026-11-01']
    );
    const firstOcc = occurrences[0];
    const confirmed = services.recurringService.confirmOccurrence(firstOcc.id, {}, '2026-10-17');
    assert.equal(confirmed.occurrence.status, 'confirmed');
    assert.throws(
      () => services.recurringService.confirmOccurrence(firstOcc.id, {}, '2026-10-17'),
      ConflictError
    );

    // Scenario F — CSV Import preview validation, duplicate detection, and commit
    const csvContent = [
      'Date,Amount,Description,Category',
      '2026-10-12,-120.00,Supermarket,Groceries', // Duplicate of existing expenseTx
      '2026-10-06,-25.50,City Bakery,Restaurants', // Valid new expense
      'invalid-date,-10.00,Broken Row,Groceries', // Invalid date
    ].join('\n');

    const preview = services.importExportService.previewCsvImport({
      csvContent,
      accountId: accountA.id,
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
    assert.equal(preview.totalRows, 3);
    assert.equal(preview.validCount, 2);
    assert.equal(preview.invalidCount, 1);
    assert.equal(preview.duplicateCount, 1);

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
      accountId: accountA.id,
      includeDuplicates: false,
      rows: validParsedRows,
    });
    assert.equal(commitRes.importedCount, 1);
    assert.equal(commitRes.skippedCount, 1);

    // Scenario G — Backup and restoration preserves data and rejects corrupted backup files
    const balanceBeforeBackup = services.accountService.getAccountById(accountA.id).current_balance_minor;
    const backupMeta = await services.backupService.createBackup('milestone');
    assert.ok(backupMeta.filename.includes('milestone'));

    // Mutate after backup
    services.transactionService.createTransaction({
      transaction_type: 'expense',
      transaction_date: '2026-10-16',
      amount_minor: 9999,
      account_id: accountA.id,
      category_id: 'cat-exp-shopping',
      description: 'Post-backup expense',
    });
    assert.equal(
      services.accountService.getAccountById(accountA.id).current_balance_minor,
      balanceBeforeBackup - 9999
    );

    // Corrupt backup rejected safely
    const corruptBase64 = Buffer.from('NOT A VALID SQLITE FILE').toString('base64');
    await assert.rejects(
      () => services.backupService.restoreFromUploadedBase64(corruptBase64, 'corrupt.sqlite'),
      ValidationError
    );

    // Restore valid backup
    const restoreRes = await services.backupService.restoreFromBackupFilename(backupMeta.filename);
    assert.equal(restoreRes.restoredFrom, backupMeta.filename);
    assert.equal(
      services.accountService.getAccountById(accountA.id).current_balance_minor,
      balanceBeforeBackup
    );
    console.log('   ✓ Mandatory Financial Scenarios A–G passed.');

    // 3. Verify HTTP Server & Security Headers (in-memory request dispatch)
    console.log('3. Verifying HTTP API server & localhost security protections...');
    const { app, services: apiServices } = createApp({
      dbPath: path.join(tmpDir, 'api.sqlite'),
      backupsDir: path.join(tmpDir, 'api-backups'),
    });

    async function invokeHandler(options: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    }): Promise<{ status: number; headers: Record<string, string>; bodyText: string; json: () => unknown }> {
      const { Readable } = await import('node:stream');
      const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : '';
      const reqStream = Readable.from(bodyStr ? [Buffer.from(bodyStr, 'utf8')] : []) as unknown as http.IncomingMessage;
      reqStream.method = options.method;
      reqStream.url = options.url;
      reqStream.headers = {
        host: '127.0.0.1:3001',
        ...(options.headers ?? {}),
      };

      return new Promise((resolve) => {
        const resHeaders: Record<string, string> = {};
        let statusCode = 200;
        const chunks: Buffer[] = [];

        const mockRes = {
          get statusCode() {
            return statusCode;
          },
          set statusCode(val: number) {
            statusCode = val;
          },
          setHeader(name: string, value: string | number) {
            resHeaders[name.toLowerCase()] = String(value);
          },
          getHeader(name: string) {
            return resHeaders[name.toLowerCase()];
          },
          writeHead(code: number, hdrs?: Record<string, string | number>) {
            statusCode = code;
            if (hdrs) {
              for (const [k, v] of Object.entries(hdrs)) {
                resHeaders[k.toLowerCase()] = String(v);
              }
            }
            return this;
          },
          write(chunk: Buffer | string) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
          },
          end(chunk?: Buffer | string) {
            if (chunk) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const bodyText = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: statusCode,
              headers: resHeaders,
              bodyText,
              json: () => JSON.parse(bodyText),
            });
          },
        } as unknown as http.ServerResponse;

        app(reqStream, mockRes);
      });
    }

    const healthRes = await invokeHandler({ method: 'GET', url: '/api/health' });
    assert.equal(healthRes.status, 200);
    assert.ok(healthRes.headers['content-security-policy']?.includes("default-src 'self'"));
    const healthBody = healthRes.json() as { status: string };
    assert.equal(healthBody.status, 'ok');

    // Cross-origin rejection check
    const csrfRes = await invokeHandler({
      method: 'POST',
      url: '/api/accounts',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
      body: { name: 'Hack', account_type: 'cash', opening_balance_minor: 0 },
    });
    assert.equal(csrfRes.status, 403);

    // Valid account creation + CSV & JSON export over HTTP API
    const createAccRes = await invokeHandler({
      method: 'POST',
      url: '/api/accounts',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3001',
      },
      body: { name: 'API Checking', account_type: 'current', opening_balance_minor: 250000 },
    });
    assert.equal(createAccRes.status, 201);

    const jsonExportRes = await invokeHandler({ method: 'GET', url: '/api/export/full.json' });
    assert.equal(jsonExportRes.status, 200);
    const exportedData = jsonExportRes.json() as { application: string };
    assert.equal(exportedData.application, 'LedgerDesk');

    apiServices.dbManager.close();
    console.log('   ✓ HTTP API & security checks passed.');
  } finally {
    services.dbManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
