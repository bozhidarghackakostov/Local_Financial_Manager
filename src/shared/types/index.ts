export type AccountType = 'cash' | 'current' | 'savings' | 'credit_card' | 'other';
export type AccountStatus = 'active' | 'archived';

export type CategoryType = 'income' | 'expense';
export type TransactionType = 'income' | 'expense' | 'transfer';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'cancelled';
export type OccurrenceStatus = 'pending' | 'confirmed' | 'skipped';

export type GoalStatus = 'active' | 'completed' | 'archived';
export type BudgetStatus = 'active' | 'archived';

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_year'
  | 'custom';

export type DateFormatPreference = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export interface AppSettings {
  base_currency: string;
  date_format: DateFormatPreference;
  default_period: PeriodPreset;
}

export interface Account {
  id: string;
  name: string;
  account_type: AccountType;
  opening_balance_minor: number;
  current_balance_minor: number;
  inflow_minor: number;
  outflow_minor: number;
  net_movement_minor: number;
  transaction_count: number;
  currency: string;
  description: string;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  category_type: CategoryType;
  parent_id: string | null;
  parent_name?: string | null;
  display_order: number;
  is_archived: boolean;
  transaction_count?: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRecord {
  id: string;
  transaction_type: TransactionType;
  transaction_date: string; // YYYY-MM-DD
  amount_minor: number; // positive integer minor units
  currency: string;
  account_id: string;
  account_name?: string;
  destination_account_id: string | null;
  destination_account_name?: string | null;
  category_id: string | null;
  category_name?: string | null;
  category_type?: CategoryType | null;
  description: string;
  notes: string;
  tags: string[];
  is_refund: boolean;
  refunded_transaction_id: string | null;
  import_batch_id: string | null;
  import_external_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PaginatedTransactions {
  items: TransactionRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BudgetWithActuals {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  period_month: string; // YYYY-MM
  planned_amount_minor: number;
  actual_minor: number;
  remaining_minor: number;
  percentage_used: number;
  is_overspent: boolean;
  notes: string;
  status: BudgetStatus;
  created_at: string;
  updated_at: string;
}

export interface RecurringRule {
  id: string;
  name: string;
  transaction_type: 'income' | 'expense';
  amount_minor: number;
  account_id: string;
  account_name?: string;
  category_id: string;
  category_name?: string;
  description: string;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  status: RecurringStatus;
  created_at: string;
  updated_at: string;
}

export interface RecurringOccurrence {
  id: string;
  recurring_rule_id: string;
  rule_name: string;
  transaction_type: 'income' | 'expense';
  account_id: string;
  account_name: string;
  category_id: string;
  category_name: string;
  due_date: string;
  expected_amount_minor: number;
  status: OccurrenceStatus;
  urgency: 'overdue' | 'due_soon' | 'upcoming' | 'resolved';
  linked_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount_minor: number;
  current_amount_minor: number;
  remaining_amount_minor: number;
  percentage_achieved: number;
  target_date: string | null;
  account_id: string | null;
  account_name?: string | null;
  description: string;
  status: GoalStatus;
  contributions_count: number;
  created_at: string;
  updated_at: string;
}

export interface SavingsContribution {
  id: string;
  goal_id: string;
  amount_minor: number;
  contribution_date: string;
  linked_transaction_id: string | null;
  notes: string;
  created_at: string;
}

export interface CategorySummaryItem {
  category_id: string;
  category_name: string;
  category_type: CategoryType;
  amount_minor: number;
  percentage: number;
  transaction_count: number;
}

export interface MonthlyCashFlowItem {
  month: string; // YYYY-MM
  income_minor: number;
  expense_minor: number;
  net_minor: number;
}

export interface AccountReportItem {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  status: AccountStatus;
  opening_balance_minor: number;
  current_balance_minor: number;
  period_income_minor: number;
  period_expense_minor: number;
  period_transfer_in_minor: number;
  period_transfer_out_minor: number;
  period_net_minor: number;
}

export interface DashboardSummary {
  period: {
    preset: PeriodPreset;
    startDate: string;
    endDate: string;
  };
  currency: string;
  total_balance_minor: number;
  active_accounts_count: number;
  period_income_minor: number;
  period_expense_minor: number;
  net_cash_flow_minor: number;
  budgets_summary: {
    month: string;
    total_planned_minor: number;
    total_actual_minor: number;
    items: BudgetWithActuals[];
  };
  upcoming_occurrences: RecurringOccurrence[];
  goals_summary: SavingsGoal[];
  recent_transactions: TransactionRecord[];
  cash_flow_series: MonthlyCashFlowItem[];
  spending_by_category: CategorySummaryItem[];
}

export interface CsvColumnMapping {
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
}

export interface CsvPreviewRow {
  rowIndex: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  isProbableDuplicate: boolean;
  duplicateReason?: string;
  parsed?: {
    transaction_date: string;
    transaction_type: 'income' | 'expense';
    amount_minor: number;
    description: string;
    notes: string;
    category_id: string;
    category_name: string;
    import_external_id: string | null;
  };
}

export interface CsvPreviewResult {
  headers: string[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  rows: CsvPreviewRow[];
}

export interface BackupMetadata {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}
