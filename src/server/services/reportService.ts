import type { DatabaseManager } from '../db/connection.ts';
import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { TransactionRepository } from '../repositories/transactionRepository.ts';
import type { BudgetRepository } from '../repositories/budgetRepository.ts';
import type { GoalRepository } from '../repositories/goalRepository.ts';
import type { SettingsRepository } from '../repositories/settingsRepository.ts';
import type { RecurringService } from './recurringService.ts';
import type {
  AccountReportItem,
  BudgetWithActuals,
  CategorySummaryItem,
  CategoryType,
  DashboardSummary,
  MonthlyCashFlowItem,
  PeriodPreset,
  SavingsGoal,
  TransactionRecord,
} from '../../shared/types/index.ts';
import {
  addCalendarDays,
  getCurrentIsoMonth,
  getTodayIsoDate,
  resolvePeriodRange,
} from '../../shared/utils/dates.ts';
import { calculatePercentage, minorUnitsToDecimalString } from '../../shared/utils/money.ts';
import { ValidationError } from '../errors/index.ts';

export interface PeriodFilterInput {
  preset?: PeriodPreset;
  startDate?: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  referenceDate?: string;
}

export class ReportService {
    private readonly dbManager: DatabaseManager;
  private readonly accountRepo: AccountRepository;
  private readonly txRepo: TransactionRepository;
  private readonly budgetRepo: BudgetRepository;
  private readonly goalRepo: GoalRepository;
  private readonly settingsRepo: SettingsRepository;
  private readonly recurringService: RecurringService;
  constructor(dbManager: DatabaseManager, accountRepo: AccountRepository, txRepo: TransactionRepository, budgetRepo: BudgetRepository, goalRepo: GoalRepository, settingsRepo: SettingsRepository, recurringService: RecurringService) {
    this.dbManager = dbManager;
    this.accountRepo = accountRepo;
    this.txRepo = txRepo;
    this.budgetRepo = budgetRepo;
    this.goalRepo = goalRepo;
    this.settingsRepo = settingsRepo;
    this.recurringService = recurringService;
  }

  public resolvePeriod(input: PeriodFilterInput = {}): {
    preset: PeriodPreset;
    startDate: string;
    endDate: string;
  } {
    const settings = this.settingsRepo.getAll();
    const preset: PeriodPreset =
      input.preset ?? (input.startDate && input.endDate ? 'custom' : settings.default_period);
    try {
      return resolvePeriodRange(
        preset,
        input.referenceDate ?? getTodayIsoDate(),
        input.startDate,
        input.endDate
      );
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
  }

  public getDashboardSummary(input: PeriodFilterInput = {}): DashboardSummary {
    const settings = this.settingsRepo.getAll();
    const refDate = input.referenceDate ?? getTodayIsoDate();
    const period = this.resolvePeriod({ ...input, referenceDate: refDate });

    const activeAccounts = this.accountRepo.findAll({ includeArchived: false });
    const totalBalanceMinor = activeAccounts.reduce((sum, a) => sum + a.current_balance_minor, 0);

    const totals = this.getIncomeAndExpenseTotals({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
    });

    const targetMonth = period.endDate.slice(0, 7) || getCurrentIsoMonth();
    const budgets = this.budgetRepo.findAll({
      periodMonth: targetMonth,
      includeArchived: false,
    });
    const totalPlanned = budgets.reduce((s, b) => s + b.planned_amount_minor, 0);
    const totalActual = budgets.reduce((s, b) => s + b.actual_minor, 0);

    const upcomingOccurrences = this.recurringService
      .listOccurrences({
        status: 'pending',
        maxDueDate: addCalendarDays(refDate, 35),
        referenceDate: refDate,
      })
      .slice(0, 8);

    const goalsSummary = this.goalRepo.findAll({ status: 'active' });

    const recentTransactions = this.txRepo.query({
      status: 'active',
      page: 1,
      pageSize: 8,
      sortBy: 'date',
      sortOrder: 'desc',
    }).items;

    const cashFlowSeries = this.getMonthlyCashFlow({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
    });

    const spendingByCategory = this.getCategoryBreakdown({
      type: 'expense',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
    });

    return {
      period,
      currency: settings.base_currency,
      total_balance_minor: totalBalanceMinor,
      active_accounts_count: activeAccounts.length,
      period_income_minor: totals.income_minor,
      period_expense_minor: totals.expense_minor,
      net_cash_flow_minor: totals.net_minor,
      budgets_summary: {
        month: targetMonth,
        total_planned_minor: totalPlanned,
        total_actual_minor: totalActual,
        items: budgets,
      },
      upcoming_occurrences: upcomingOccurrences,
      goals_summary: goalsSummary,
      recent_transactions: recentTransactions,
      cash_flow_series: cashFlowSeries,
      spending_by_category: spendingByCategory,
    };
  }

  public getIncomeAndExpenseTotals(options: {
    startDate: string;
    endDate: string;
    accountId?: string;
    categoryId?: string;
  }): { income_minor: number; expense_minor: number; net_minor: number } {
    const conditions: string[] = [
      't.deleted_at IS NULL',
      't.transaction_date >= ?',
      't.transaction_date <= ?',
    ];
    const params: string[] = [options.startDate, options.endDate];

    if (options.accountId) {
      conditions.push('t.account_id = ?');
      params.push(options.accountId);
    }
    if (options.categoryId) {
      conditions.push('t.category_id = ?');
      params.push(options.categoryId);
    }

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN t.transaction_type = 'income' THEN t.amount_minor ELSE 0 END), 0) AS income_minor,
        COALESCE(SUM(
          CASE
            WHEN t.transaction_type = 'expense' AND t.is_refund = 0 THEN t.amount_minor
            WHEN t.transaction_type = 'expense' AND t.is_refund = 1 THEN -t.amount_minor
            ELSE 0
          END
        ), 0) AS expense_minor
      FROM transactions t
      WHERE ${conditions.join(' AND ')}
    `;

    const row = this.dbManager.db.prepare(sql).get(...params) as {
      income_minor: number;
      expense_minor: number;
    };
    const income = Number(row.income_minor);
    const expense = Number(row.expense_minor);
    return {
      income_minor: income,
      expense_minor: expense,
      net_minor: income - expense,
    };
  }

  public getMonthlyCashFlow(options: {
    startDate: string;
    endDate: string;
    accountId?: string;
    categoryId?: string;
  }): MonthlyCashFlowItem[] {
    const conditions: string[] = [
      't.deleted_at IS NULL',
      "t.transaction_type IN ('income', 'expense')",
      't.transaction_date >= ?',
      't.transaction_date <= ?',
    ];
    const params: string[] = [options.startDate, options.endDate];

    if (options.accountId) {
      conditions.push('t.account_id = ?');
      params.push(options.accountId);
    }
    if (options.categoryId) {
      conditions.push('t.category_id = ?');
      params.push(options.categoryId);
    }

    const sql = `
      SELECT
        substr(t.transaction_date, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'income' THEN t.amount_minor ELSE 0 END), 0) AS income_minor,
        COALESCE(SUM(
          CASE
            WHEN t.transaction_type = 'expense' AND t.is_refund = 0 THEN t.amount_minor
            WHEN t.transaction_type = 'expense' AND t.is_refund = 1 THEN -t.amount_minor
            ELSE 0
          END
        ), 0) AS expense_minor
      FROM transactions t
      WHERE ${conditions.join(' AND ')}
      GROUP BY substr(t.transaction_date, 1, 7)
      ORDER BY month ASC
    `;

    const rows = this.dbManager.db.prepare(sql).all(...params) as Array<{
      month: string;
      income_minor: number;
      expense_minor: number;
    }>;

    return rows.map((r) => {
      const income = Number(r.income_minor);
      const expense = Number(r.expense_minor);
      return {
        month: r.month,
        income_minor: income,
        expense_minor: expense,
        net_minor: income - expense,
      };
    });
  }

  public getCategoryBreakdown(options: {
    type: CategoryType;
    startDate: string;
    endDate: string;
    accountId?: string;
  }): CategorySummaryItem[] {
    const conditions: string[] = [
      't.deleted_at IS NULL',
      't.transaction_type = ?',
      't.transaction_date >= ?',
      't.transaction_date <= ?',
    ];
    const params: string[] = [options.type, options.startDate, options.endDate];

    if (options.accountId) {
      conditions.push('t.account_id = ?');
      params.push(options.accountId);
    }

    const sql = `
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.category_type,
        COALESCE(SUM(
          CASE WHEN t.is_refund = 1 THEN -t.amount_minor ELSE t.amount_minor END
        ), 0) AS amount_minor,
        COUNT(*) AS transaction_count
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.id, c.name, c.category_type
      HAVING amount_minor != 0
      ORDER BY amount_minor DESC, c.name ASC
    `;

    const rows = this.dbManager.db.prepare(sql).all(...params) as Array<{
      category_id: string;
      category_name: string;
      category_type: CategoryType;
      amount_minor: number;
      transaction_count: number;
    }>;

    const positiveTotal = rows.reduce((sum, r) => sum + Math.max(0, Number(r.amount_minor)), 0);

    return rows.map((r) => {
      const amount = Number(r.amount_minor);
      return {
        category_id: r.category_id,
        category_name: r.category_name,
        category_type: r.category_type,
        amount_minor: amount,
        percentage: calculatePercentage(Math.max(0, amount), positiveTotal),
        transaction_count: Number(r.transaction_count),
      };
    });
  }

  public getAccountReport(options: { startDate: string; endDate: string }): AccountReportItem[] {
    const accounts = this.accountRepo.findAll({ includeArchived: true });

    return accounts.map((acc) => {
      const row = this.dbManager.db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN t.account_id = ? AND t.transaction_type = 'income' THEN t.amount_minor ELSE 0 END), 0) AS period_income_minor,
            COALESCE(SUM(
              CASE
                WHEN t.account_id = ? AND t.transaction_type = 'expense' AND t.is_refund = 0 THEN t.amount_minor
                WHEN t.account_id = ? AND t.transaction_type = 'expense' AND t.is_refund = 1 THEN -t.amount_minor
                ELSE 0
              END
            ), 0) AS period_expense_minor,
            COALESCE(SUM(CASE WHEN t.destination_account_id = ? AND t.transaction_type = 'transfer' THEN t.amount_minor ELSE 0 END), 0) AS period_transfer_in_minor,
            COALESCE(SUM(CASE WHEN t.account_id = ? AND t.transaction_type = 'transfer' THEN t.amount_minor ELSE 0 END), 0) AS period_transfer_out_minor
           FROM transactions t
           WHERE t.deleted_at IS NULL
             AND t.transaction_date >= ?
             AND t.transaction_date <= ?
             AND (t.account_id = ? OR t.destination_account_id = ?)`
        )
        .get(
          acc.id,
          acc.id,
          acc.id,
          acc.id,
          acc.id,
          options.startDate,
          options.endDate,
          acc.id,
          acc.id
        ) as {
        period_income_minor: number;
        period_expense_minor: number;
        period_transfer_in_minor: number;
        period_transfer_out_minor: number;
      };

      const income = Number(row.period_income_minor);
      const expense = Number(row.period_expense_minor);
      const transferIn = Number(row.period_transfer_in_minor);
      const transferOut = Number(row.period_transfer_out_minor);
      const net = income - expense + transferIn - transferOut;

      return {
        account_id: acc.id,
        account_name: acc.name,
        account_type: acc.account_type,
        status: acc.status,
        opening_balance_minor: acc.opening_balance_minor,
        current_balance_minor: acc.current_balance_minor,
        period_income_minor: income,
        period_expense_minor: expense,
        period_transfer_in_minor: transferIn,
        period_transfer_out_minor: transferOut,
        period_net_minor: net,
      };
    });
  }

  public getFullReportBundle(input: PeriodFilterInput = {}): {
    period: { preset: PeriodPreset; startDate: string; endDate: string };
    currency: string;
    totals: { income_minor: number; expense_minor: number; net_minor: number };
    monthly_cash_flow: MonthlyCashFlowItem[];
    spending_by_category: CategorySummaryItem[];
    income_by_category: CategorySummaryItem[];
    account_report: AccountReportItem[];
    budget_performance: BudgetWithActuals[];
    goals_progress: SavingsGoal[];
    transactions: TransactionRecord[];
  } {
    const settings = this.settingsRepo.getAll();
    const period = this.resolvePeriod(input);

    const totals = this.getIncomeAndExpenseTotals({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
      categoryId: input.categoryId,
    });

    const monthly_cash_flow = this.getMonthlyCashFlow({
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
      categoryId: input.categoryId,
    });

    const spending_by_category = this.getCategoryBreakdown({
      type: 'expense',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
    });

    const income_by_category = this.getCategoryBreakdown({
      type: 'income',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
    });

    const account_report = this.getAccountReport({
      startDate: period.startDate,
      endDate: period.endDate,
    });

    const budget_performance = this.budgetRepo.findAll({ includeArchived: false });
    const goals_progress = this.goalRepo.findAll();

    const transactions = this.txRepo.findAllMatching({
      status: 'active',
      startDate: period.startDate,
      endDate: period.endDate,
      accountId: input.accountId,
      categoryId: input.categoryId,
    });

    return {
      period,
      currency: settings.base_currency,
      totals,
      monthly_cash_flow,
      spending_by_category,
      income_by_category,
      account_report,
      budget_performance,
      goals_progress,
      transactions,
    };
  }

  public exportReportToCsv(
    reportType: 'cash_flow' | 'spending_by_category' | 'income_by_category' | 'accounts' | 'budgets' | 'goals',
    input: PeriodFilterInput = {}
  ): string {
    const bundle = this.getFullReportBundle(input);
    const escapeCsv = (val: string | number | null | undefined): string => {
      const str = val === null || val === undefined ? '' : String(val);
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    switch (reportType) {
      case 'cash_flow': {
        const header = ['Month', 'Income', 'Expense', 'Net Cash Flow'];
        const rows = bundle.monthly_cash_flow.map((m) => [
          m.month,
          minorUnitsToDecimalString(m.income_minor),
          minorUnitsToDecimalString(m.expense_minor),
          minorUnitsToDecimalString(m.net_minor),
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
      case 'spending_by_category': {
        const header = ['Category', 'Amount', 'Percentage (%)', 'Transaction Count'];
        const rows = bundle.spending_by_category.map((c) => [
          c.category_name,
          minorUnitsToDecimalString(c.amount_minor),
          c.percentage,
          c.transaction_count,
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
      case 'income_by_category': {
        const header = ['Category', 'Amount', 'Percentage (%)', 'Transaction Count'];
        const rows = bundle.income_by_category.map((c) => [
          c.category_name,
          minorUnitsToDecimalString(c.amount_minor),
          c.percentage,
          c.transaction_count,
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
      case 'accounts': {
        const header = [
          'Account',
          'Type',
          'Status',
          'Opening Balance',
          'Current Balance',
          'Period Income',
          'Period Expense',
          'Period Transfer In',
          'Period Transfer Out',
          'Period Net Movement',
        ];
        const rows = bundle.account_report.map((a) => [
          a.account_name,
          a.account_type,
          a.status,
          minorUnitsToDecimalString(a.opening_balance_minor),
          minorUnitsToDecimalString(a.current_balance_minor),
          minorUnitsToDecimalString(a.period_income_minor),
          minorUnitsToDecimalString(a.period_expense_minor),
          minorUnitsToDecimalString(a.period_transfer_in_minor),
          minorUnitsToDecimalString(a.period_transfer_out_minor),
          minorUnitsToDecimalString(a.period_net_minor),
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
      case 'budgets': {
        const header = [
          'Period Month',
          'Budget Name',
          'Category',
          'Planned Limit',
          'Actual Spending',
          'Remaining',
          'Percentage Used (%)',
          'Overspent',
        ];
        const rows = bundle.budget_performance.map((b) => [
          b.period_month,
          b.name,
          b.category_name,
          minorUnitsToDecimalString(b.planned_amount_minor),
          minorUnitsToDecimalString(b.actual_minor),
          minorUnitsToDecimalString(b.remaining_minor),
          b.percentage_used,
          b.is_overspent ? 'Yes' : 'No',
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
      case 'goals': {
        const header = [
          'Goal Name',
          'Status',
          'Target Amount',
          'Current Progress',
          'Remaining Amount',
          'Percentage Achieved (%)',
          'Target Date',
        ];
        const rows = bundle.goals_progress.map((g) => [
          g.name,
          g.status,
          minorUnitsToDecimalString(g.target_amount_minor),
          minorUnitsToDecimalString(g.current_amount_minor),
          minorUnitsToDecimalString(g.remaining_amount_minor),
          g.percentage_achieved,
          g.target_date ?? '',
        ]);
        return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      }
    }
  }
}
