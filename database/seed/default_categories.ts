export interface DefaultCategorySeed {
  id: string;
  name: string;
  category_type: 'income' | 'expense';
  display_order: number;
}

export const DEFAULT_CATEGORIES: DefaultCategorySeed[] = [
  // Expense categories
  { id: 'cat-exp-housing', name: 'Housing', category_type: 'expense', display_order: 1 },
  { id: 'cat-exp-groceries', name: 'Groceries', category_type: 'expense', display_order: 2 },
  { id: 'cat-exp-restaurants', name: 'Restaurants', category_type: 'expense', display_order: 3 },
  { id: 'cat-exp-transport', name: 'Transport', category_type: 'expense', display_order: 4 },
  { id: 'cat-exp-utilities', name: 'Utilities', category_type: 'expense', display_order: 5 },
  { id: 'cat-exp-health', name: 'Health', category_type: 'expense', display_order: 6 },
  { id: 'cat-exp-shopping', name: 'Shopping', category_type: 'expense', display_order: 7 },
  { id: 'cat-exp-entertainment', name: 'Entertainment', category_type: 'expense', display_order: 8 },
  { id: 'cat-exp-subscriptions', name: 'Subscriptions', category_type: 'expense', display_order: 9 },
  { id: 'cat-exp-education', name: 'Education', category_type: 'expense', display_order: 10 },
  { id: 'cat-exp-travel', name: 'Travel', category_type: 'expense', display_order: 11 },
  { id: 'cat-exp-other', name: 'Other Expense', category_type: 'expense', display_order: 12 },

  // Income categories
  { id: 'cat-inc-salary', name: 'Salary', category_type: 'income', display_order: 1 },
  { id: 'cat-inc-freelance', name: 'Freelance', category_type: 'income', display_order: 2 },
  { id: 'cat-inc-business', name: 'Business Income', category_type: 'income', display_order: 3 },
  { id: 'cat-inc-interest', name: 'Interest', category_type: 'income', display_order: 4 },
  { id: 'cat-inc-gifts', name: 'Gifts', category_type: 'income', display_order: 5 },
  { id: 'cat-inc-other', name: 'Other Income', category_type: 'income', display_order: 6 },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  base_currency: 'USD',
  date_format: 'YYYY-MM-DD',
  default_period: 'this_month',
};
