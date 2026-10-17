import { Router } from 'express';
import type { ServicesContainer } from '../app.ts';
import type {
  CategoryType,
  GoalStatus,
  OccurrenceStatus,
  PeriodPreset,
  RecurringStatus,
  TransactionType,
} from '../../shared/types/index.ts';
import { ValidationError } from '../errors/index.ts';

export function createApiRouter(services: ServicesContainer): Router {
  const router = Router();

  // 1. Health & Diagnostics
  router.get('/health', (_req, res) => {
    const settings = services.settingsService.getSettings();
    res.json({
      status: 'ok',
      application: 'LedgerDesk',
      mode: 'offline-local',
      base_currency: settings.base_currency,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Application Settings
  router.get('/settings', (_req, res) => {
    res.json({ data: services.settingsService.getSettings() });
  });

  router.patch('/settings', (req, res) => {
    const updated = services.settingsService.updateSettings(req.body);
    res.json({ data: updated });
  });

  // 3. Dashboard
  const handleDashboard = (req: { query: Record<string, unknown> }, res: { json: (body: unknown) => void }) => {
    const summary = services.reportService.getDashboardSummary({
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      accountId: (req.query.accountId as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    res.json({ data: summary });
  };

  router.get('/dashboard', handleDashboard);
  router.get('/dashboard/summary', handleDashboard);

  // 4. Accounts
  router.get('/accounts', (req, res) => {
    const includeArchived = req.query.includeArchived !== 'false';
    res.json({ data: services.accountService.listAccounts({ includeArchived }) });
  });

  router.post('/accounts', (req, res) => {
    const account = services.accountService.createAccount(req.body);
    res.status(201).json({ data: account });
  });

  router.get('/accounts/:id', (req, res) => {
    const account = services.accountService.getAccountById(req.params.id);
    const transactions = services.transactionService.listTransactions({
      accountId: account.id,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    });
    res.json({ data: { account, transactions } });
  });

  router.patch('/accounts/:id', (req, res) => {
    const updated = services.accountService.updateAccount(req.params.id, req.body);
    res.json({ data: updated });
  });

  router.post('/accounts/:id/archive', (req, res) => {
    const archived = req.body?.archived !== false;
    const updated = services.accountService.archiveAccount(req.params.id, archived);
    res.json({ data: updated });
  });

  router.delete('/accounts/:id', (req, res) => {
    services.accountService.deleteAccount(req.params.id);
    res.status(204).send();
  });

  // 5. Categories
  router.get('/categories', (req, res) => {
    const type = (req.query.type as CategoryType) || undefined;
    const includeArchived = req.query.includeArchived !== 'false';
    res.json({ data: services.categoryService.listCategories({ type, includeArchived }) });
  });

  router.post('/categories', (req, res) => {
    const category = services.categoryService.createCategory(req.body);
    res.status(201).json({ data: category });
  });

  router.patch('/categories/:id', (req, res) => {
    const updated = services.categoryService.updateCategory(req.params.id, req.body);
    res.json({ data: updated });
  });

  router.delete('/categories/:id', (req, res) => {
    const reassignTo =
      (req.query.reassignToCategoryId as string) ||
      (req.body?.reassignToCategoryId as string) ||
      undefined;
    services.categoryService.deleteCategory(req.params.id, reassignTo);
    res.status(204).send();
  });

  // 6. Transactions
  router.get('/transactions', (req, res) => {
    const result = services.transactionService.listTransactions({
      search: (req.query.search as string) || undefined,
      type: (req.query.type as TransactionType) || undefined,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      status: (req.query.status as 'active' | 'trashed' | 'all') || 'active',
      sortBy: (req.query.sortBy as 'date' | 'amount' | 'account' | 'category' | 'updated_at') || 'date',
      sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    });
    res.json({ data: result });
  });

  router.post('/transactions', (req, res) => {
    const tx = services.transactionService.createTransaction(req.body);
    res.status(201).json({ data: tx });
  });

  router.get('/transactions/:id', (req, res) => {
    const tx = services.transactionService.getTransactionById(req.params.id);
    res.json({ data: tx });
  });

  router.patch('/transactions/:id', (req, res) => {
    const tx = services.transactionService.updateTransaction(req.params.id, req.body);
    res.json({ data: tx });
  });

  router.delete('/transactions/:id', (req, res) => {
    const permanent = req.query.permanent === 'true';
    const result = services.transactionService.deleteTransaction(req.params.id, permanent);
    if (permanent) {
      res.status(204).send();
    } else {
      res.json({ data: result });
    }
  });

  router.post('/transactions/:id/restore', (req, res) => {
    const restored = services.transactionService.restoreTransaction(req.params.id);
    res.json({ data: restored });
  });

  router.post('/transactions/:id/duplicate', (req, res) => {
    const duplicated = services.transactionService.duplicateTransaction(req.params.id, req.body);
    res.status(201).json({ data: duplicated });
  });

  // 7. Budgets
  router.get('/budgets', (req, res) => {
    const periodMonth = (req.query.periodMonth as string) || undefined;
    const includeArchived = req.query.includeArchived === 'true';
    res.json({
      data: services.budgetService.listBudgets({
        periodMonth,
        includeArchived,
      }),
    });
  });

  router.post('/budgets', (req, res) => {
    const budget = services.budgetService.createBudget(req.body);
    res.status(201).json({ data: budget });
  });

  router.patch('/budgets/:id', (req, res) => {
    const updated = services.budgetService.updateBudget(req.params.id, req.body);
    res.json({ data: updated });
  });

  router.delete('/budgets/:id', (req, res) => {
    services.budgetService.deleteBudget(req.params.id);
    res.status(204).send();
  });

  // 8. Recurring Rules & Occurrences
  router.get('/recurring', (req, res) => {
    const status = (req.query.status as RecurringStatus) || undefined;
    const referenceDate = (req.query.referenceDate as string) || undefined;
    const rules = services.recurringService.listRules({ status, referenceDate });
    const occurrences = services.recurringService.listOccurrences({ referenceDate });
    res.json({ data: { rules, occurrences } });
  });

  router.get('/recurring/occurrences', (req, res) => {
    const occurrences = services.recurringService.listOccurrences({
      ruleId: (req.query.ruleId as string) || undefined,
      status: (req.query.status as OccurrenceStatus) || undefined,
      maxDueDate: (req.query.maxDueDate as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    res.json({ data: occurrences });
  });

  router.post('/recurring', (req, res) => {
    const rule = services.recurringService.createRule(req.body);
    res.status(201).json({ data: rule });
  });

  router.patch('/recurring/:id', (req, res) => {
    const updated = services.recurringService.updateRule(req.params.id, req.body);
    res.json({ data: updated });
  });

  // Supports confirming either by occurrence ID or by rule's next pending occurrence
  router.post('/recurring/:id/confirm-payment', (req, res) => {
    const targetId = req.params.id;
    let occurrenceId = (req.body?.occurrenceId as string) || targetId;

    if (targetId.startsWith('rec-') && !req.body?.occurrenceId) {
      const pending = services.recurringService.listOccurrences({
        ruleId: targetId,
        status: 'pending',
      });
      if (pending.length === 0) {
        throw new ValidationError('No pending occurrence found for this recurring rule');
      }
      occurrenceId = pending[0].id;
    }

    const result = services.recurringService.confirmOccurrence(occurrenceId, req.body);
    res.status(201).json({ data: result });
  });

  router.post('/recurring/occurrences/:occurrenceId/confirm', (req, res) => {
    const result = services.recurringService.confirmOccurrence(req.params.occurrenceId, req.body);
    res.status(201).json({ data: result });
  });

  router.post('/recurring/occurrences/:occurrenceId/skip', (req, res) => {
    const result = services.recurringService.skipOccurrence(req.params.occurrenceId);
    res.json({ data: result });
  });

  // 9. Savings Goals
  router.get('/goals', (req, res) => {
    const status = (req.query.status as GoalStatus) || undefined;
    res.json({ data: services.goalService.listGoals({ status }) });
  });

  router.post('/goals', (req, res) => {
    const goal = services.goalService.createGoal(req.body);
    res.status(201).json({ data: goal });
  });

  router.get('/goals/:id', (req, res) => {
    res.json({ data: services.goalService.getGoalById(req.params.id) });
  });

  router.patch('/goals/:id', (req, res) => {
    const updated = services.goalService.updateGoal(req.params.id, req.body);
    res.json({ data: updated });
  });

  router.delete('/goals/:id', (req, res) => {
    services.goalService.deleteGoal(req.params.id);
    res.status(204).send();
  });

  router.post('/goals/:id/contributions', (req, res) => {
    const result = services.goalService.addContribution(req.params.id, req.body);
    res.status(201).json({ data: result });
  });

  router.delete('/goals/:id/contributions/:contributionId', (req, res) => {
    const updatedGoal = services.goalService.deleteContribution(
      req.params.id,
      req.params.contributionId
    );
    res.json({ data: updatedGoal });
  });

  // 10. Reports
  router.get('/reports/bundle', (req, res) => {
    const bundle = services.reportService.getFullReportBundle({
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    res.json({ data: bundle });
  });

  router.get('/reports/cash-flow', (req, res) => {
    const period = services.reportService.resolvePeriod({
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    const totals = services.reportService.getIncomeAndExpenseTotals({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
    });
    const series = services.reportService.getMonthlyCashFlow({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
    });
    res.json({ data: { period, totals, series } });
  });

  router.get('/reports/categories', (req, res) => {
    const period = services.reportService.resolvePeriod({
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    const expense = services.reportService.getCategoryBreakdown({
      type: 'expense',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: (req.query.accountId as string) || undefined,
    });
    const income = services.reportService.getCategoryBreakdown({
      type: 'income',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: (req.query.accountId as string) || undefined,
    });
    res.json({ data: { period, expense, income } });
  });

  router.get('/reports/accounts', (req, res) => {
    const period = services.reportService.resolvePeriod({
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      referenceDate: (req.query.referenceDate as string) || undefined,
    });
    const accounts = services.reportService.getAccountReport({
      startDate: period.startDate,
      endDate: period.endDate,
    });
    res.json({ data: { period, accounts } });
  });

  router.get('/reports/budgets', (req, res) => {
    const periodMonth = (req.query.periodMonth as string) || undefined;
    const budgets = services.budgetService.listBudgets({ periodMonth });
    res.json({ data: budgets });
  });

  router.get('/reports/export.csv', (req, res) => {
    const reportType =
      ((req.query.reportType as string) as
        | 'cash_flow'
        | 'spending_by_category'
        | 'income_by_category'
        | 'accounts'
        | 'budgets'
        | 'goals') || 'cash_flow';
    const csv = services.reportService.exportReportToCsv(reportType, {
      preset: (req.query.preset as PeriodPreset) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledgerdesk-report-${reportType}.csv"`);
    res.send(csv);
  });

  // 11. CSV Import & Export
  router.post('/imports/csv/inspect', (req, res) => {
    const result = services.importExportService.inspectCsvHeaders(
      req.body?.csvContent,
      req.body?.delimiter
    );
    res.json({ data: result });
  });

  router.post('/imports/csv/preview', (req, res) => {
    const preview = services.importExportService.previewCsvImport(req.body);
    res.json({ data: preview });
  });

  router.post('/imports/csv/commit', (req, res) => {
    const result = services.importExportService.commitCsvImport(req.body);
    res.status(201).json({ data: result });
  });

  router.get('/export/transactions.csv', (req, res) => {
    const csv = services.importExportService.exportTransactionsCsv({
      type: (req.query.type as TransactionType) || undefined,
      accountId: (req.query.accountId as string) || undefined,
      categoryId: (req.query.categoryId as string) || undefined,
      startDate: (req.query.startDate as string) || undefined,
      endDate: (req.query.endDate as string) || undefined,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ledgerdesk-transactions.csv"');
    res.send(csv);
  });

  router.get('/export/full.json', (_req, res) => {
    const jsonPayload = services.importExportService.exportFullJson();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ledgerdesk-export.json"');
    res.send(JSON.stringify(jsonPayload, null, 2));
  });

  // 12. Database Backup & Restore
  router.get('/backup', (_req, res) => {
    res.json({ data: services.backupService.listBackups() });
  });

  router.post('/backup', async (req, res, next) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
      const meta = await services.backupService.createBackup(label);
      res.status(201).json({ data: meta });
    } catch (err) {
      next(err);
    }
  });

  router.get('/backup/:filename/download', (req, res, next) => {
    try {
      const filePath = services.backupService.getBackupFilePath(req.params.filename);
      res.download(filePath, req.params.filename);
    } catch (err) {
      next(err);
    }
  });

  router.post('/backup/restore', async (req, res, next) => {
    try {
      if (req.body?.base64Data) {
        const result = await services.backupService.restoreFromUploadedBase64(
          req.body.base64Data,
          req.body.filename || 'uploaded.sqlite'
        );
        res.json({ data: result });
        return;
      }

      if (typeof req.body?.filename === 'string' && req.body.filename.trim()) {
        const result = await services.backupService.restoreFromBackupFilename(
          req.body.filename.trim()
        );
        res.json({ data: result });
        return;
      }

      throw new ValidationError('Provide either a backup filename or base64Data to restore');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
