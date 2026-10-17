import type {
  Account,
  AccountReportItem,
  AppSettings,
  BackupMetadata,
  BudgetWithActuals,
  Category,
  CategorySummaryItem,
  CategoryType,
  CsvPreviewResult,
  DashboardSummary,
  GoalStatus,
  MonthlyCashFlowItem,
  OccurrenceStatus,
  PaginatedTransactions,
  PeriodPreset,
  RecurringOccurrence,
  RecurringRule,
  RecurringStatus,
  SavingsContribution,
  SavingsGoal,
  TransactionRecord,
  TransactionType,
} from '../../shared/types/index.js';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code: string = 'API_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let body: { data?: T; error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(`Unexpected server response (${response.status})`, response.status);
  }

  if (!response.ok) {
    throw new ApiClientError(
      body?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error?.code ?? 'API_ERROR',
      body?.error?.details
    );
  }

  return (body && 'data' in body ? body.data : body) as T;
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      sp.set(key, String(val));
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}

export const apiClient = {
  // Health & Settings
  getHealth: () =>
    requestJson<{ status: string; application: string; mode: string; base_currency: string }>('/api/health'),
  getSettings: () => requestJson<AppSettings>('/api/settings'),
  updateSettings: (payload: Partial<AppSettings>) =>
    requestJson<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(payload) }),

  // Dashboard
  getDashboardSummary: (params: {
    preset?: PeriodPreset;
    startDate?: string;
    endDate?: string;
    accountId?: string;
  } = {}) => requestJson<DashboardSummary>(`/api/dashboard/summary${buildQuery(params)}`),

  // Accounts
  getAccounts: (includeArchived = true) =>
    requestJson<Account[]>(`/api/accounts${buildQuery({ includeArchived })}`),
  getAccountDetails: (id: string, page = 1, pageSize = 50) =>
    requestJson<{ account: Account; transactions: PaginatedTransactions }>(
      `/api/accounts/${encodeURIComponent(id)}${buildQuery({ page, pageSize })}`
    ),
  createAccount: (payload: {
    name: string;
    account_type: Account['account_type'];
    opening_balance_minor: number;
    description?: string;
  }) => requestJson<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (
    id: string,
    payload: Partial<{
      name: string;
      account_type: Account['account_type'];
      opening_balance_minor: number;
      description: string;
      status: Account['status'];
    }>
  ) =>
    requestJson<Account>(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  archiveAccount: (id: string, archived = true) =>
    requestJson<Account>(`/api/accounts/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived }),
    }),
  deleteAccount: (id: string) =>
    requestJson<void>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Categories
  getCategories: (params: { type?: CategoryType; includeArchived?: boolean } = {}) =>
    requestJson<Category[]>(`/api/categories${buildQuery(params)}`),
  createCategory: (payload: {
    name: string;
    category_type: CategoryType;
    parent_id?: string | null;
    display_order?: number;
  }) => requestJson<Category>('/api/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (
    id: string,
    payload: Partial<{
      name: string;
      parent_id: string | null;
      display_order: number;
      is_archived: boolean;
    }>
  ) =>
    requestJson<Category>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCategory: (id: string, reassignToCategoryId?: string) =>
    requestJson<void>(
      `/api/categories/${encodeURIComponent(id)}${buildQuery({ reassignToCategoryId })}`,
      { method: 'DELETE' }
    ),

  // Transactions
  getTransactions: (
    params: {
      search?: string;
      type?: TransactionType;
      accountId?: string;
      categoryId?: string;
      startDate?: string;
      endDate?: string;
      status?: 'active' | 'trashed' | 'all';
      sortBy?: 'date' | 'amount' | 'account' | 'category' | 'updated_at';
      sortOrder?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    } = {}
  ) => requestJson<PaginatedTransactions>(`/api/transactions${buildQuery(params)}`),
  createTransaction: (payload: {
    transaction_type: TransactionType;
    transaction_date: string;
    amount_minor: number;
    account_id: string;
    destination_account_id?: string | null;
    category_id?: string | null;
    description?: string;
    notes?: string;
    tags?: string[];
    is_refund?: boolean;
    refunded_transaction_id?: string | null;
  }) =>
    requestJson<TransactionRecord>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTransaction: (
    id: string,
    payload: Partial<{
      transaction_type: TransactionType;
      transaction_date: string;
      amount_minor: number;
      account_id: string;
      destination_account_id: string | null;
      category_id: string | null;
      description: string;
      notes: string;
      tags: string[];
      is_refund: boolean;
      refunded_transaction_id: string | null;
    }>
  ) =>
    requestJson<TransactionRecord>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTransaction: (id: string, permanent = false) =>
    requestJson<TransactionRecord | void>(
      `/api/transactions/${encodeURIComponent(id)}${buildQuery({ permanent })}`,
      { method: 'DELETE' }
    ),
  restoreTransaction: (id: string) =>
    requestJson<TransactionRecord>(`/api/transactions/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    }),
  duplicateTransaction: (id: string, transactionDate?: string) =>
    requestJson<TransactionRecord>(`/api/transactions/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify(transactionDate ? { transaction_date: transactionDate } : {}),
    }),

  // Budgets
  getBudgets: (params: { periodMonth?: string; includeArchived?: boolean } = {}) =>
    requestJson<BudgetWithActuals[]>(`/api/budgets${buildQuery(params)}`),
  createBudget: (payload: {
    name: string;
    category_id: string | null;
    period_month: string;
    planned_amount_minor: number;
    notes?: string;
  }) =>
    requestJson<BudgetWithActuals>('/api/budgets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBudget: (
    id: string,
    payload: Partial<{
      name: string;
      planned_amount_minor: number;
      notes: string;
      status: 'active' | 'archived';
    }>
  ) =>
    requestJson<BudgetWithActuals>(`/api/budgets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteBudget: (id: string) =>
    requestJson<void>(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Recurring Rules & Occurrences
  getRecurring: (params: { status?: RecurringStatus } = {}) =>
    requestJson<{ rules: RecurringRule[]; occurrences: RecurringOccurrence[] }>(
      `/api/recurring${buildQuery(params)}`
    ),
  getRecurringOccurrences: (params: {
    ruleId?: string;
    status?: OccurrenceStatus;
    maxDueDate?: string;
  } = {}) => requestJson<RecurringOccurrence[]>(`/api/recurring/occurrences${buildQuery(params)}`),
  createRecurringRule: (payload: {
    name: string;
    transaction_type: 'income' | 'expense';
    amount_minor: number;
    account_id: string;
    category_id: string;
    description?: string;
    frequency: RecurringRule['frequency'];
    interval_count?: number;
    start_date: string;
    end_date?: string | null;
  }) =>
    requestJson<RecurringRule>('/api/recurring', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRecurringRule: (
    id: string,
    payload: Partial<{
      name: string;
      amount_minor: number;
      account_id: string;
      category_id: string;
      description: string;
      frequency: RecurringRule['frequency'];
      interval_count: number;
      end_date: string | null;
      status: RecurringStatus;
    }>
  ) =>
    requestJson<RecurringRule>(`/api/recurring/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  confirmOccurrence: (
    occurrenceId: string,
    payload: { transaction_date?: string; amount_minor?: number; notes?: string } = {}
  ) =>
    requestJson<{ occurrence: RecurringOccurrence; transaction: TransactionRecord }>(
      `/api/recurring/occurrences/${encodeURIComponent(occurrenceId)}/confirm`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  skipOccurrence: (occurrenceId: string) =>
    requestJson<RecurringOccurrence>(
      `/api/recurring/occurrences/${encodeURIComponent(occurrenceId)}/skip`,
      { method: 'POST' }
    ),

  // Savings Goals
  getGoals: (params: { status?: GoalStatus } = {}) =>
    requestJson<SavingsGoal[]>(`/api/goals${buildQuery(params)}`),
  getGoalById: (id: string) =>
    requestJson<SavingsGoal & { contributions: SavingsContribution[] }>(
      `/api/goals/${encodeURIComponent(id)}`
    ),
  createGoal: (payload: {
    name: string;
    target_amount_minor: number;
    target_date?: string | null;
    account_id?: string | null;
    description?: string;
    initial_contribution_minor?: number;
  }) =>
    requestJson<SavingsGoal>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGoal: (
    id: string,
    payload: Partial<{
      name: string;
      target_amount_minor: number;
      target_date: string | null;
      account_id: string | null;
      description: string;
      status: GoalStatus;
    }>
  ) =>
    requestJson<SavingsGoal>(`/api/goals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteGoal: (id: string) =>
    requestJson<void>(`/api/goals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addGoalContribution: (
    goalId: string,
    payload: {
      amount_minor: number;
      contribution_date: string;
      linked_transaction_id?: string | null;
      notes?: string;
    }
  ) =>
    requestJson<{ goal: SavingsGoal; contribution: SavingsContribution }>(
      `/api/goals/${encodeURIComponent(goalId)}/contributions`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  deleteGoalContribution: (goalId: string, contributionId: string) =>
    requestJson<SavingsGoal>(
      `/api/goals/${encodeURIComponent(goalId)}/contributions/${encodeURIComponent(contributionId)}`,
      { method: 'DELETE' }
    ),

  // Reports
  getReportBundle: (
    params: {
      preset?: PeriodPreset;
      startDate?: string;
      endDate?: string;
      accountId?: string;
      categoryId?: string;
    } = {}
  ) =>
    requestJson<{
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
    }>(`/api/reports/bundle${buildQuery(params)}`),

  // CSV Import
  inspectCsvHeaders: (csvContent: string, delimiter: ',' | ';' | '\t' = ',') =>
    requestJson<{
      headers: string[];
      sampleRows: Array<Record<string, string>>;
      totalRows: number;
    }>('/api/imports/csv/inspect', {
      method: 'POST',
      body: JSON.stringify({ csvContent, delimiter }),
    }),
  previewCsvImport: (payload: {
    csvContent: string;
    accountId: string;
    delimiter: ',' | ';' | '\t';
    mapping: {
      dateColumn: string;
      amountColumn: string;
      descriptionColumn: string;
      typeColumn?: string;
      categoryColumn?: string;
      notesColumn?: string;
      externalIdColumn?: string;
      dateFormat?: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
      decimalSeparator?: '.' | ',';
      defaultCategoryId?: string;
    };
  }) =>
    requestJson<CsvPreviewResult>('/api/imports/csv/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitCsvImport: (payload: {
    sourceFilename: string;
    accountId: string;
    includeDuplicates: boolean;
    rows: Array<{
      rowIndex: number;
      skip: boolean;
      isProbableDuplicate: boolean;
      transaction_date: string;
      transaction_type: 'income' | 'expense';
      amount_minor: number;
      category_id: string;
      description: string;
      notes: string;
      import_external_id: string | null;
    }>;
  }) =>
    requestJson<{
      batchId: string;
      importedCount: number;
      skippedCount: number;
      errorCount: number;
    }>('/api/imports/csv/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Backups
  getBackups: () => requestJson<BackupMetadata[]>('/api/backup'),
  createBackup: (label?: string) =>
    requestJson<BackupMetadata>('/api/backup', {
      method: 'POST',
      body: JSON.stringify(label ? { label } : {}),
    }),
  restoreBackupByFilename: (filename: string) =>
    requestJson<{ restoredFrom: string; safetyBackupFilename: string }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  restoreBackupFromBase64: (base64Data: string, filename: string) =>
    requestJson<{ restoredFrom: string; safetyBackupFilename: string }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ base64Data, filename }),
    }),
};
