import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseManager } from './db/connection.ts';
import { runMigrations } from './db/migrator.ts';
import { SettingsRepository } from './repositories/settingsRepository.ts';
import { AccountRepository } from './repositories/accountRepository.ts';
import { CategoryRepository } from './repositories/categoryRepository.ts';
import { TransactionRepository } from './repositories/transactionRepository.ts';
import { BudgetRepository } from './repositories/budgetRepository.ts';
import { RecurringRepository } from './repositories/recurringRepository.ts';
import { GoalRepository } from './repositories/goalRepository.ts';
import { SettingsService } from './services/settingsService.ts';
import { AccountService } from './services/accountService.ts';
import { CategoryService } from './services/categoryService.ts';
import { TransactionService } from './services/transactionService.ts';
import { BudgetService } from './services/budgetService.ts';
import { RecurringService } from './services/recurringService.ts';
import { GoalService } from './services/goalService.ts';
import { ReportService } from './services/reportService.ts';
import { ImportExportService } from './services/importExportService.ts';
import { BackupService } from './services/backupService.ts';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from './errors/index.ts';
import type {
  CategoryType,
  GoalStatus,
  OccurrenceStatus,
  PeriodPreset,
  RecurringStatus,
  TransactionType,
} from '../shared/types/index.ts';

export interface ServicesContainer {
  dbManager: DatabaseManager;
  settingsRepo: SettingsRepository;
  accountRepo: AccountRepository;
  categoryRepo: CategoryRepository;
  txRepo: TransactionRepository;
  budgetRepo: BudgetRepository;
  recurringRepo: RecurringRepository;
  goalRepo: GoalRepository;
  settingsService: SettingsService;
  accountService: AccountService;
  categoryService: CategoryService;
  transactionService: TransactionService;
  budgetService: BudgetService;
  recurringService: RecurringService;
  goalService: GoalService;
  reportService: ReportService;
  importExportService: ImportExportService;
  backupService: BackupService;
}

export function createServices(
  options: { dbPath?: string; backupsDir?: string } = {}
): ServicesContainer {
  const dbManager = new DatabaseManager(options.dbPath, options.backupsDir);
  runMigrations(dbManager);

  const settingsRepo = new SettingsRepository(dbManager);
  const accountRepo = new AccountRepository(dbManager);
  const categoryRepo = new CategoryRepository(dbManager);
  const txRepo = new TransactionRepository(dbManager);
  const budgetRepo = new BudgetRepository(dbManager);
  const recurringRepo = new RecurringRepository(dbManager);
  const goalRepo = new GoalRepository(dbManager);

  const settingsService = new SettingsService(settingsRepo);
  const accountService = new AccountService(accountRepo, settingsRepo);
  const categoryService = new CategoryService(categoryRepo);
  const transactionService = new TransactionService(
    txRepo,
    accountRepo,
    categoryRepo,
    settingsRepo
  );
  const budgetService = new BudgetService(budgetRepo, categoryRepo);
  const recurringService = new RecurringService(
    dbManager,
    recurringRepo,
    accountRepo,
    categoryRepo,
    transactionService
  );
  const goalService = new GoalService(dbManager, goalRepo, accountRepo, txRepo);
  const reportService = new ReportService(
    dbManager,
    accountRepo,
    txRepo,
    budgetRepo,
    goalRepo,
    settingsRepo,
    recurringService
  );
  const importExportService = new ImportExportService(
    dbManager,
    accountRepo,
    categoryRepo,
    txRepo,
    settingsRepo
  );
  const backupService = new BackupService(dbManager);

  return {
    dbManager,
    settingsRepo,
    accountRepo,
    categoryRepo,
    txRepo,
    budgetRepo,
    recurringRepo,
    goalRepo,
    settingsService,
    accountService,
    categoryService,
    transactionService,
    budgetService,
    recurringService,
    goalService,
    reportService,
    importExportService,
    backupService,
  };
}

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function applySecurityAndCheckOrigin(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const rawHost = req.headers.host;
  if (rawHost) {
    const hostname = rawHost.split(':')[0].toLowerCase();
    if (!ALLOWED_HOSTS.has(hostname)) {
      throw new ForbiddenError('Request rejected: untrusted Host header');
    }
  }

  const method = (req.method || 'GET').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const origin = req.headers.origin;
    if (origin) {
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new ForbiddenError('Request rejected: malformed Origin header');
      }
      if (!ALLOWED_HOSTS.has(parsedOrigin.hostname.toLowerCase())) {
        throw new ForbiddenError('Request rejected: cross-origin requests are not permitted');
      }
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    throw new ValidationError('Malformed JSON request body');
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export type HttpAppHandler = (req: IncomingMessage, res: ServerResponse) => void;

export function createApp(options: { dbPath?: string; backupsDir?: string } = {}): {
  app: HttpAppHandler;
  services: ServicesContainer;
} {
  const services = createServices(options);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      applySecurityAndCheckOrigin(req, res);

      const method = (req.method || 'GET').toUpperCase();
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const query = Object.fromEntries(parsedUrl.searchParams.entries());

      if (pathname.startsWith('/api/')) {
        await handleApiRequest(method, pathname, query, req, res, services);
        return;
      }

      // Serve static client files from dist/client (checking working directory and module locations)
      const thisFileDir = path.dirname(new URL(import.meta.url).pathname);
      const candidateDistDirs = [
        path.join(process.cwd(), 'dist', 'client'),
        path.join(thisFileDir, '..', 'client'),
        path.join(thisFileDir, '..', 'dist', 'client'),
        path.join(thisFileDir, 'client'),
      ];
      const clientDistDir = candidateDistDirs.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? candidateDistDirs[0];
      if (fs.existsSync(clientDistDir)) {
        const relativeReq = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const candidatePath = path.resolve(clientDistDir, relativeReq);
        if (
          candidatePath.startsWith(path.resolve(clientDistDir)) &&
          fs.existsSync(candidatePath) &&
          fs.statSync(candidatePath).isFile()
        ) {
          const ext = path.extname(candidatePath).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.json': 'application/json; charset=utf-8',
          };
          const content = fs.readFileSync(candidatePath);
          res.writeHead(200, {
            'Content-Type': mimeMap[ext] || 'application/octet-stream',
            'Content-Length': content.length,
          });
          res.end(content);
          return;
        }

        const indexHtmlPath = path.join(clientDistDir, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          const content = fs.readFileSync(indexHtmlPath);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': content.length,
          });
          res.end(content);
          return;
        }
      }

      throw new NotFoundError('Resource not found');
    } catch (err) {
      if (err instanceof AppError) {
        sendJson(res, err.statusCode, {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
        return;
      }
      sendJson(res, 500, {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred while processing the request.',
        },
      });
    }
  };

  const app: HttpAppHandler = (req, res) => {
    void handler(req, res);
  };

  return { app, services };
}

async function handleApiRequest(
  method: string,
  pathname: string,
  query: Record<string, string>,
  req: IncomingMessage,
  res: ServerResponse,
  services: ServicesContainer
): Promise<void> {
  const segments = pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);

  // GET /api/health
  if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    const settings = services.settingsService.getSettings();
    sendJson(res, 200, {
      status: 'ok',
      application: 'LedgerDesk',
      mode: 'offline-local',
      base_currency: settings.base_currency,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // /api/settings
  if (segments.length === 1 && segments[0] === 'settings') {
    if (method === 'GET') {
      sendJson(res, 200, { data: services.settingsService.getSettings() });
      return;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.settingsService.updateSettings(body) });
      return;
    }
  }

  // /api/dashboard or /api/dashboard/summary
  if (
    method === 'GET' &&
    segments[0] === 'dashboard' &&
    (segments.length === 1 || (segments.length === 2 && segments[1] === 'summary'))
  ) {
    const summary = services.reportService.getDashboardSummary({
      preset: (query.preset as PeriodPreset) || undefined,
      startDate: query.startDate || undefined,
      endDate: query.endDate || undefined,
      accountId: query.accountId || undefined,
      referenceDate: query.referenceDate || undefined,
    });
    sendJson(res, 200, { data: summary });
    return;
  }

  // /api/accounts
  if (segments[0] === 'accounts') {
    if (segments.length === 1 && method === 'GET') {
      const includeArchived = query.includeArchived !== 'false';
      sendJson(res, 200, { data: services.accountService.listAccounts({ includeArchived }) });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.accountService.createAccount(body) });
      return;
    }
    if (segments.length === 2 && method === 'GET') {
      const account = services.accountService.getAccountById(segments[1]);
      const transactions = services.transactionService.listTransactions({
        accountId: account.id,
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 50,
      });
      sendJson(res, 200, { data: { account, transactions } });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.accountService.updateAccount(segments[1], body) });
      return;
    }
    if (segments.length === 2 && method === 'DELETE') {
      services.accountService.deleteAccount(segments[1]);
      res.writeHead(204);
      res.end();
      return;
    }
    if (segments.length === 3 && segments[2] === 'archive' && method === 'POST') {
      const body = await readJsonBody(req);
      const archived = body.archived !== false;
      sendJson(res, 200, { data: services.accountService.archiveAccount(segments[1], archived) });
      return;
    }
  }

  // /api/categories
  if (segments[0] === 'categories') {
    if (segments.length === 1 && method === 'GET') {
      const type = (query.type as CategoryType) || undefined;
      const includeArchived = query.includeArchived !== 'false';
      sendJson(res, 200, { data: services.categoryService.listCategories({ type, includeArchived }) });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.categoryService.createCategory(body) });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.categoryService.updateCategory(segments[1], body) });
      return;
    }
    if (segments.length === 2 && method === 'DELETE') {
      const body = await readJsonBody(req);
      const reassignTo =
        query.reassignToCategoryId ||
        (typeof body.reassignToCategoryId === 'string' ? body.reassignToCategoryId : undefined);
      services.categoryService.deleteCategory(segments[1], reassignTo);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // /api/transactions
  if (segments[0] === 'transactions') {
    if (segments.length === 1 && method === 'GET') {
      const result = services.transactionService.listTransactions({
        search: query.search || undefined,
        type: (query.type as TransactionType) || undefined,
        accountId: query.accountId || undefined,
        categoryId: query.categoryId || undefined,
        startDate: query.startDate || undefined,
        endDate: query.endDate || undefined,
        status: (query.status as 'active' | 'trashed' | 'all') || 'active',
        sortBy: (query.sortBy as 'date' | 'amount' | 'account' | 'category' | 'updated_at') || 'date',
        sortOrder: (query.sortOrder as 'asc' | 'desc') || 'desc',
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 50,
      });
      sendJson(res, 200, { data: result });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.transactionService.createTransaction(body) });
      return;
    }
    if (segments.length === 2 && method === 'GET') {
      sendJson(res, 200, { data: services.transactionService.getTransactionById(segments[1]) });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.transactionService.updateTransaction(segments[1], body) });
      return;
    }
    if (segments.length === 2 && method === 'DELETE') {
      const permanent = query.permanent === 'true';
      const result = services.transactionService.deleteTransaction(segments[1], permanent);
      if (permanent) {
        res.writeHead(204);
        res.end();
      } else {
        sendJson(res, 200, { data: result });
      }
      return;
    }
    if (segments.length === 3 && segments[2] === 'restore' && method === 'POST') {
      sendJson(res, 200, { data: services.transactionService.restoreTransaction(segments[1]) });
      return;
    }
    if (segments.length === 3 && segments[2] === 'duplicate' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, {
        data: services.transactionService.duplicateTransaction(segments[1], body as { transaction_date?: string }),
      });
      return;
    }
  }

  // /api/budgets
  if (segments[0] === 'budgets') {
    if (segments.length === 1 && method === 'GET') {
      const periodMonth = query.periodMonth || undefined;
      const includeArchived = query.includeArchived === 'true';
      sendJson(res, 200, {
        data: services.budgetService.listBudgets({ periodMonth, includeArchived }),
      });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.budgetService.createBudget(body) });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.budgetService.updateBudget(segments[1], body) });
      return;
    }
    if (segments.length === 2 && method === 'DELETE') {
      services.budgetService.deleteBudget(segments[1]);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // /api/recurring
  if (segments[0] === 'recurring') {
    if (segments.length === 1 && method === 'GET') {
      const status = (query.status as RecurringStatus) || undefined;
      const referenceDate = query.referenceDate || undefined;
      const rules = services.recurringService.listRules({ status, referenceDate });
      const occurrences = services.recurringService.listOccurrences({ referenceDate });
      sendJson(res, 200, { data: { rules, occurrences } });
      return;
    }
    if (segments.length === 2 && segments[1] === 'occurrences' && method === 'GET') {
      const occurrences = services.recurringService.listOccurrences({
        ruleId: query.ruleId || undefined,
        status: (query.status as OccurrenceStatus) || undefined,
        maxDueDate: query.maxDueDate || undefined,
        referenceDate: query.referenceDate || undefined,
      });
      sendJson(res, 200, { data: occurrences });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.recurringService.createRule(body) });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.recurringService.updateRule(segments[1], body) });
      return;
    }
    if (segments.length === 3 && segments[2] === 'confirm-payment' && method === 'POST') {
      const body = await readJsonBody(req);
      const targetId = segments[1];
      let occurrenceId = typeof body.occurrenceId === 'string' ? body.occurrenceId : targetId;
      if (targetId.startsWith('rec-') && !body.occurrenceId) {
        const pending = services.recurringService.listOccurrences({
          ruleId: targetId,
          status: 'pending',
        });
        if (pending.length === 0) {
          throw new ValidationError('No pending occurrence found for this recurring rule');
        }
        occurrenceId = pending[0].id;
      }
      sendJson(res, 201, {
        data: services.recurringService.confirmOccurrence(occurrenceId, body),
      });
      return;
    }
    if (
      segments.length === 4 &&
      segments[1] === 'occurrences' &&
      segments[3] === 'confirm' &&
      method === 'POST'
    ) {
      const body = await readJsonBody(req);
      sendJson(res, 201, {
        data: services.recurringService.confirmOccurrence(segments[2], body),
      });
      return;
    }
    if (
      segments.length === 4 &&
      segments[1] === 'occurrences' &&
      segments[3] === 'skip' &&
      method === 'POST'
    ) {
      sendJson(res, 200, {
        data: services.recurringService.skipOccurrence(segments[2]),
      });
      return;
    }
  }

  // /api/goals
  if (segments[0] === 'goals') {
    if (segments.length === 1 && method === 'GET') {
      const status = (query.status as GoalStatus) || undefined;
      sendJson(res, 200, { data: services.goalService.listGoals({ status }) });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.goalService.createGoal(body) });
      return;
    }
    if (segments.length === 2 && method === 'GET') {
      sendJson(res, 200, { data: services.goalService.getGoalById(segments[1]) });
      return;
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { data: services.goalService.updateGoal(segments[1], body) });
      return;
    }
    if (segments.length === 2 && method === 'DELETE') {
      services.goalService.deleteGoal(segments[1]);
      res.writeHead(204);
      res.end();
      return;
    }
    if (segments.length === 3 && segments[2] === 'contributions' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, { data: services.goalService.addContribution(segments[1], body) });
      return;
    }
    if (segments.length === 4 && segments[2] === 'contributions' && method === 'DELETE') {
      sendJson(res, 200, {
        data: services.goalService.deleteContribution(segments[1], segments[3]),
      });
      return;
    }
  }

  // /api/reports/*
  if (segments[0] === 'reports' && method === 'GET') {
    const filterInput = {
      preset: (query.preset as PeriodPreset) || undefined,
      startDate: query.startDate || undefined,
      endDate: query.endDate || undefined,
      accountId: query.accountId || undefined,
      categoryId: query.categoryId || undefined,
      referenceDate: query.referenceDate || undefined,
    };

    if (segments[1] === 'bundle') {
      sendJson(res, 200, { data: services.reportService.getFullReportBundle(filterInput) });
      return;
    }
    if (segments[1] === 'cash-flow') {
      const period = services.reportService.resolvePeriod(filterInput);
      const totals = services.reportService.getIncomeAndExpenseTotals({
        startDate: period.startDate,
        endDate: period.endDate,
        accountId: filterInput.accountId,
        categoryId: filterInput.categoryId,
      });
      const series = services.reportService.getMonthlyCashFlow({
        startDate: period.startDate,
        endDate: period.endDate,
        accountId: filterInput.accountId,
        categoryId: filterInput.categoryId,
      });
      sendJson(res, 200, { data: { period, totals, series } });
      return;
    }
    if (segments[1] === 'categories') {
      const period = services.reportService.resolvePeriod(filterInput);
      const expense = services.reportService.getCategoryBreakdown({
        type: 'expense',
        startDate: period.startDate,
        endDate: period.endDate,
        accountId: filterInput.accountId,
      });
      const income = services.reportService.getCategoryBreakdown({
        type: 'income',
        startDate: period.startDate,
        endDate: period.endDate,
        accountId: filterInput.accountId,
      });
      sendJson(res, 200, { data: { period, expense, income } });
      return;
    }
    if (segments[1] === 'accounts') {
      const period = services.reportService.resolvePeriod(filterInput);
      const accounts = services.reportService.getAccountReport({
        startDate: period.startDate,
        endDate: period.endDate,
      });
      sendJson(res, 200, { data: { period, accounts } });
      return;
    }
    if (segments[1] === 'budgets') {
      sendJson(res, 200, {
        data: services.budgetService.listBudgets({ periodMonth: query.periodMonth || undefined }),
      });
      return;
    }
    if (segments[1] === 'export.csv') {
      const reportType =
        (query.reportType as
          | 'cash_flow'
          | 'spending_by_category'
          | 'income_by_category'
          | 'accounts'
          | 'budgets'
          | 'goals') || 'cash_flow';
      const csv = services.reportService.exportReportToCsv(reportType, filterInput);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ledgerdesk-report-${reportType}.csv"`,
      });
      res.end(csv);
      return;
    }
  }

  // /api/imports/csv/*
  if (segments[0] === 'imports' && segments[1] === 'csv' && method === 'POST') {
    const body = await readJsonBody(req);
    if (segments[2] === 'inspect') {
      const result = services.importExportService.inspectCsvHeaders(
        body.csvContent as string,
        body.delimiter as ',' | ';' | '\t'
      );
      sendJson(res, 200, { data: result });
      return;
    }
    if (segments[2] === 'preview') {
      sendJson(res, 200, { data: services.importExportService.previewCsvImport(body) });
      return;
    }
    if (segments[2] === 'commit') {
      sendJson(res, 201, { data: services.importExportService.commitCsvImport(body) });
      return;
    }
  }

  // /api/export/*
  if (segments[0] === 'export' && method === 'GET') {
    if (segments[1] === 'transactions.csv') {
      const csv = services.importExportService.exportTransactionsCsv({
        type: (query.type as TransactionType) || undefined,
        accountId: query.accountId || undefined,
        categoryId: query.categoryId || undefined,
        startDate: query.startDate || undefined,
        endDate: query.endDate || undefined,
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ledgerdesk-transactions.csv"',
      });
      res.end(csv);
      return;
    }
    if (segments[1] === 'full.json') {
      const payload = services.importExportService.exportFullJson();
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ledgerdesk-export.json"',
      });
      res.end(body);
      return;
    }
  }

  // /api/backup/*
  if (segments[0] === 'backup') {
    if (segments.length === 1 && method === 'GET') {
      sendJson(res, 200, { data: services.backupService.listBackups() });
      return;
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const label = typeof body.label === 'string' ? body.label : undefined;
      const meta = await services.backupService.createBackup(label);
      sendJson(res, 201, { data: meta });
      return;
    }
    if (segments.length === 3 && segments[2] === 'download' && method === 'GET') {
      const filePath = services.backupService.getBackupFilePath(segments[1]);
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="${segments[1]}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
      return;
    }
    if (segments.length === 2 && segments[1] === 'restore' && method === 'POST') {
      const body = await readJsonBody(req);
      if (typeof body.base64Data === 'string' && body.base64Data) {
        const result = await services.backupService.restoreFromUploadedBase64(
          body.base64Data,
          typeof body.filename === 'string' ? body.filename : 'uploaded.sqlite'
        );
        sendJson(res, 200, { data: result });
        return;
      }
      if (typeof body.filename === 'string' && body.filename.trim()) {
        const result = await services.backupService.restoreFromBackupFilename(body.filename.trim());
        sendJson(res, 200, { data: result });
        return;
      }
      throw new ValidationError('Provide either a backup filename or base64Data to restore');
    }
  }

  throw new NotFoundError(`API endpoint not found: ${method} ${pathname}`);
}

export function createHttpServer(options: { dbPath?: string; backupsDir?: string } = {}): {
  server: http.Server;
  services: ServicesContainer;
} {
  const { app, services } = createApp(options);
  const server = http.createServer(app);
  return { server, services };
}
