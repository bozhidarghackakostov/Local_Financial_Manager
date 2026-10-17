export type NavPageId =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'recurring'
  | 'goals'
  | 'reports'
  | 'settings';

export interface NavItem {
  id: NavPageId;
  label: string;
  description: string;
}

export const MAIN_NAVIGATION: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Overview of balances, cash flow, budgets, upcoming payments, and savings goals.',
  },
  {
    id: 'transactions',
    label: 'Transactions',
    description: 'Central financial ledger for income, expenses, refunds, and inter-account transfers.',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Manage cash, current, savings, and credit accounts with ledger-reconciled balances.',
  },
  {
    id: 'budgets',
    label: 'Budgets',
    description: 'Plan monthly spending limits and monitor actual eligible spending against targets.',
  },
  {
    id: 'recurring',
    label: 'Recurring Payments',
    description: 'Track scheduled bills, subscriptions, and recurring income with manual payment confirmation.',
  },
  {
    id: 'goals',
    label: 'Savings Goals',
    description: 'Track progress and contributions toward financial targets.',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Auditable cash flow, category breakdowns, account movements, and CSV exports.',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Configure currency, date formats, categories, data exports, and SQLite database backups.',
  },
];
