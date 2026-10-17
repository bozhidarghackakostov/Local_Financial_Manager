import {
  SUPPORTED_CURRENCY_CODES,
  DATE_FORMATS,
  PERIOD_PRESETS,
  CATEGORY_TYPES,
  TRANSACTION_TYPES,
  RECURRING_FREQUENCIES,
  GOAL_STATUSES,
} from '../constants/index.ts';
import { isValidIsoDate, isValidIsoMonth } from '../utils/dates.ts';
import type {
  AccountType,
  AccountStatus,
  CategoryType,
  TransactionType,
  RecurringFrequency,
  RecurringStatus,
  GoalStatus,
  BudgetStatus,
  DateFormatPreference,
  PeriodPreset,
} from '../types/index.ts';

export interface ValidationIssue {
  path: string[];
  message: string;
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: ValidationIssue[] } };

export interface SchemaValidator<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

function fail(message: string, path: string[] = []): SafeParseResult<never> {
  return { success: false, error: { issues: [{ path, message }] } };
}

function ok<T>(data: T): SafeParseResult<T> {
  return { success: true, data };
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function checkPositiveMinorUnits(val: unknown, field: string): SafeParseResult<number> {
  if (typeof val !== 'number' || !Number.isInteger(val) || !Number.isFinite(val)) {
    return fail(`${field} must be an integer in minor units`, [field]);
  }
  if (val <= 0) {
    return fail(`${field} must be greater than zero`, [field]);
  }
  if (val > Number.MAX_SAFE_INTEGER) {
    return fail(`${field} exceeds safe integer bounds`, [field]);
  }
  return ok(val);
}

function checkSignedMinorUnits(val: unknown, field: string): SafeParseResult<number> {
  if (typeof val !== 'number' || !Number.isInteger(val) || !Number.isFinite(val)) {
    return fail(`${field} must be an integer in minor units`, [field]);
  }
  if (val > Number.MAX_SAFE_INTEGER || val < Number.MIN_SAFE_INTEGER) {
    return fail(`${field} exceeds safe integer bounds`, [field]);
  }
  return ok(val);
}

export const updateSettingsSchema: SchemaValidator<{
  base_currency?: string;
  date_format?: DateFormatPreference;
  default_period?: PeriodPreset;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Settings input must be an object');
    const out: {
      base_currency?: string;
      date_format?: DateFormatPreference;
      default_period?: PeriodPreset;
    } = {};

    if (input.base_currency !== undefined) {
      if (
        typeof input.base_currency !== 'string' ||
        !(SUPPORTED_CURRENCY_CODES as readonly string[]).includes(input.base_currency)
      ) {
        return fail('Unsupported currency code', ['base_currency']);
      }
      out.base_currency = input.base_currency;
    }

    if (input.date_format !== undefined) {
      if (
        typeof input.date_format !== 'string' ||
        !(DATE_FORMATS as readonly string[]).includes(input.date_format)
      ) {
        return fail('Unsupported date format', ['date_format']);
      }
      out.date_format = input.date_format as DateFormatPreference;
    }

    if (input.default_period !== undefined) {
      const validPresets = PERIOD_PRESETS.map((p) => p.value) as readonly string[];
      if (typeof input.default_period !== 'string' || !validPresets.includes(input.default_period)) {
        return fail('Unsupported default period', ['default_period']);
      }
      out.default_period = input.default_period as PeriodPreset;
    }

    return ok(out);
  },
};

const VALID_ACCOUNT_TYPES = ['cash', 'current', 'savings', 'credit_card', 'other'] as const;

export const createAccountSchema: SchemaValidator<{
  name: string;
  account_type: AccountType;
  opening_balance_minor: number;
  description: string;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid account payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) {
      return fail('Account name is required (1-100 characters)', ['name']);
    }
    if (
      typeof input.account_type !== 'string' ||
      !(VALID_ACCOUNT_TYPES as readonly string[]).includes(input.account_type)
    ) {
      return fail('Invalid account type', ['account_type']);
    }
    const openingRaw = input.opening_balance_minor === undefined ? 0 : input.opening_balance_minor;
    const openingRes = checkSignedMinorUnits(openingRaw, 'opening_balance_minor');
    if (!openingRes.success) return openingRes;

    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (description.length > 500) {
      return fail('Description is too long', ['description']);
    }

    return ok({
      name,
      account_type: input.account_type as AccountType,
      opening_balance_minor: openingRes.data,
      description,
    });
  },
};

export const updateAccountSchema: SchemaValidator<{
  name?: string;
  account_type?: AccountType;
  opening_balance_minor?: number;
  description?: string;
  status?: AccountStatus;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid account update payload');
    const out: {
      name?: string;
      account_type?: AccountType;
      opening_balance_minor?: number;
      description?: string;
      status?: AccountStatus;
    } = {};

    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 100) return fail('Account name cannot be empty', ['name']);
      out.name = name;
    }
    if (input.account_type !== undefined) {
      if (
        typeof input.account_type !== 'string' ||
        !(VALID_ACCOUNT_TYPES as readonly string[]).includes(input.account_type)
      ) {
        return fail('Invalid account type', ['account_type']);
      }
      out.account_type = input.account_type as AccountType;
    }
    if (input.opening_balance_minor !== undefined) {
      const res = checkSignedMinorUnits(input.opening_balance_minor, 'opening_balance_minor');
      if (!res.success) return res;
      out.opening_balance_minor = res.data;
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string' || input.description.length > 500) {
        return fail('Invalid description', ['description']);
      }
      out.description = input.description.trim();
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'archived') {
        return fail('Invalid account status', ['status']);
      }
      out.status = input.status;
    }

    return ok(out);
  },
};

export const createCategorySchema: SchemaValidator<{
  name: string;
  category_type: CategoryType;
  parent_id: string | null;
  display_order: number;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid category payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80) {
      return fail('Category name is required', ['name']);
    }
    if (
      typeof input.category_type !== 'string' ||
      !(CATEGORY_TYPES as readonly string[]).includes(input.category_type)
    ) {
      return fail('Category type must be income or expense', ['category_type']);
    }
    const parent_id =
      typeof input.parent_id === 'string' && input.parent_id.trim()
        ? input.parent_id.trim()
        : null;
    const display_order =
      typeof input.display_order === 'number' && Number.isInteger(input.display_order) && input.display_order >= 0
        ? input.display_order
        : 0;

    return ok({
      name,
      category_type: input.category_type as CategoryType,
      parent_id,
      display_order,
    });
  },
};

export const updateCategorySchema: SchemaValidator<{
  name?: string;
  parent_id?: string | null;
  display_order?: number;
  is_archived?: boolean;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid category update payload');
    const out: {
      name?: string;
      parent_id?: string | null;
      display_order?: number;
      is_archived?: boolean;
    } = {};

    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 80) return fail('Category name cannot be empty', ['name']);
      out.name = name;
    }
    if (input.parent_id !== undefined) {
      out.parent_id =
        typeof input.parent_id === 'string' && input.parent_id.trim()
          ? input.parent_id.trim()
          : null;
    }
    if (input.display_order !== undefined) {
      if (
        typeof input.display_order !== 'number' ||
        !Number.isInteger(input.display_order) ||
        input.display_order < 0
      ) {
        return fail('Display order must be a non-negative integer', ['display_order']);
      }
      out.display_order = input.display_order;
    }
    if (input.is_archived !== undefined) {
      if (typeof input.is_archived !== 'boolean') {
        return fail('is_archived must be a boolean', ['is_archived']);
      }
      out.is_archived = input.is_archived;
    }

    return ok(out);
  },
};

export const createTransactionSchema: SchemaValidator<{
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
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid transaction payload');

    if (
      typeof input.transaction_type !== 'string' ||
      !(TRANSACTION_TYPES as readonly string[]).includes(input.transaction_type)
    ) {
      return fail('Invalid transaction type', ['transaction_type']);
    }
    const transaction_type = input.transaction_type as TransactionType;

    if (typeof input.transaction_date !== 'string' || !isValidIsoDate(input.transaction_date)) {
      return fail('Must be a valid calendar date in YYYY-MM-DD format', ['transaction_date']);
    }

    const amountRes = checkPositiveMinorUnits(input.amount_minor, 'amount_minor');
    if (!amountRes.success) return amountRes;

    const account_id = typeof input.account_id === 'string' ? input.account_id.trim() : '';
    if (!account_id) {
      return fail('Account is required', ['account_id']);
    }

    const destination_account_id =
      typeof input.destination_account_id === 'string' && input.destination_account_id.trim()
        ? input.destination_account_id.trim()
        : null;

    const category_id =
      typeof input.category_id === 'string' && input.category_id.trim()
        ? input.category_id.trim()
        : null;

    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';

    let tags: string[] = [];
    if (Array.isArray(input.tags)) {
      tags = input.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    const is_refund = Boolean(input.is_refund);
    const refunded_transaction_id =
      typeof input.refunded_transaction_id === 'string' && input.refunded_transaction_id.trim()
        ? input.refunded_transaction_id.trim()
        : null;

    if (transaction_type === 'transfer') {
      if (!destination_account_id) {
        return fail('Destination account is required for transfers', ['destination_account_id']);
      }
      if (destination_account_id === account_id) {
        return fail('Cannot transfer money from an account to itself', ['destination_account_id']);
      }
      if (category_id) {
        return fail('Transfers cannot be assigned to an income or expense category', ['category_id']);
      }
      if (is_refund) {
        return fail('Transfers cannot be marked as refunds', ['is_refund']);
      }
    } else {
      if (!category_id) {
        return fail('Category is required for income and expense transactions', ['category_id']);
      }
      if (destination_account_id) {
        return fail('Destination account is only allowed for transfers', ['destination_account_id']);
      }
      if (is_refund && transaction_type !== 'expense') {
        return fail('Only expense records can be marked as expense refunds', ['is_refund']);
      }
    }

    return ok({
      transaction_type,
      transaction_date: input.transaction_date,
      amount_minor: amountRes.data,
      account_id,
      destination_account_id,
      category_id,
      description,
      notes,
      tags,
      is_refund,
      refunded_transaction_id,
    });
  },
};

export const updateTransactionSchema: SchemaValidator<{
  transaction_type?: TransactionType;
  transaction_date?: string;
  amount_minor?: number;
  account_id?: string;
  destination_account_id?: string | null;
  category_id?: string | null;
  description?: string;
  notes?: string;
  tags?: string[];
  is_refund?: boolean;
  refunded_transaction_id?: string | null;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid transaction update payload');
    const out: Record<string, unknown> = {};

    if (input.transaction_type !== undefined) {
      if (
        typeof input.transaction_type !== 'string' ||
        !(TRANSACTION_TYPES as readonly string[]).includes(input.transaction_type)
      ) {
        return fail('Invalid transaction type', ['transaction_type']);
      }
      out.transaction_type = input.transaction_type;
    }

    if (input.transaction_date !== undefined) {
      if (typeof input.transaction_date !== 'string' || !isValidIsoDate(input.transaction_date)) {
        return fail('Invalid transaction date', ['transaction_date']);
      }
      out.transaction_date = input.transaction_date;
    }

    if (input.amount_minor !== undefined) {
      const res = checkPositiveMinorUnits(input.amount_minor, 'amount_minor');
      if (!res.success) return res;
      out.amount_minor = res.data;
    }

    if (input.account_id !== undefined) {
      if (typeof input.account_id !== 'string' || !input.account_id.trim()) {
        return fail('Invalid account_id', ['account_id']);
      }
      out.account_id = input.account_id.trim();
    }

    if (input.destination_account_id !== undefined) {
      out.destination_account_id =
        typeof input.destination_account_id === 'string' && input.destination_account_id.trim()
          ? input.destination_account_id.trim()
          : null;
    }

    if (input.category_id !== undefined) {
      out.category_id =
        typeof input.category_id === 'string' && input.category_id.trim()
          ? input.category_id.trim()
          : null;
    }

    if (input.description !== undefined) {
      out.description = typeof input.description === 'string' ? input.description.trim() : '';
    }

    if (input.notes !== undefined) {
      out.notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    }

    if (input.tags !== undefined && Array.isArray(input.tags)) {
      out.tags = input.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    if (input.is_refund !== undefined) {
      out.is_refund = Boolean(input.is_refund);
    }

    if (input.refunded_transaction_id !== undefined) {
      out.refunded_transaction_id =
        typeof input.refunded_transaction_id === 'string' && input.refunded_transaction_id.trim()
          ? input.refunded_transaction_id.trim()
          : null;
    }

    return ok(out);
  },
};

export const createBudgetSchema: SchemaValidator<{
  name: string;
  category_id: string | null;
  period_month: string;
  planned_amount_minor: number;
  notes: string;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid budget payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) return fail('Budget name is required', ['name']);

    const category_id =
      typeof input.category_id === 'string' && input.category_id.trim()
        ? input.category_id.trim()
        : null;

    if (typeof input.period_month !== 'string' || !isValidIsoMonth(input.period_month)) {
      return fail('Must be a valid calendar month in YYYY-MM format', ['period_month']);
    }

    const amountRes = checkPositiveMinorUnits(input.planned_amount_minor, 'planned_amount_minor');
    if (!amountRes.success) return amountRes;

    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';

    return ok({
      name,
      category_id,
      period_month: input.period_month,
      planned_amount_minor: amountRes.data,
      notes,
    });
  },
};

export const updateBudgetSchema: SchemaValidator<{
  name?: string;
  planned_amount_minor?: number;
  notes?: string;
  status?: BudgetStatus;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid budget update payload');
    const out: {
      name?: string;
      planned_amount_minor?: number;
      notes?: string;
      status?: BudgetStatus;
    } = {};

    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return fail('Budget name cannot be empty', ['name']);
      out.name = name;
    }
    if (input.planned_amount_minor !== undefined) {
      const res = checkPositiveMinorUnits(input.planned_amount_minor, 'planned_amount_minor');
      if (!res.success) return res;
      out.planned_amount_minor = res.data;
    }
    if (input.notes !== undefined && typeof input.notes === 'string') {
      out.notes = input.notes.trim();
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'archived') {
        return fail('Invalid budget status', ['status']);
      }
      out.status = input.status;
    }
    return ok(out);
  },
};

export const createRecurringRuleSchema: SchemaValidator<{
  name: string;
  transaction_type: 'income' | 'expense';
  amount_minor: number;
  account_id: string;
  category_id: string;
  description: string;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: string;
  end_date: string | null;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid recurring rule payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return fail('Name is required', ['name']);

    if (input.transaction_type !== 'income' && input.transaction_type !== 'expense') {
      return fail('Transaction type must be income or expense', ['transaction_type']);
    }

    const amountRes = checkPositiveMinorUnits(input.amount_minor, 'amount_minor');
    if (!amountRes.success) return amountRes;

    const account_id = typeof input.account_id === 'string' ? input.account_id.trim() : '';
    if (!account_id) return fail('Account is required', ['account_id']);

    const category_id = typeof input.category_id === 'string' ? input.category_id.trim() : '';
    if (!category_id) return fail('Category is required', ['category_id']);

    if (
      typeof input.frequency !== 'string' ||
      !(RECURRING_FREQUENCIES as readonly string[]).includes(input.frequency)
    ) {
      return fail('Invalid recurrence frequency', ['frequency']);
    }

    const interval_count =
      input.interval_count === undefined ? 1 : Number(input.interval_count);
    if (!Number.isInteger(interval_count) || interval_count < 1 || interval_count > 365) {
      return fail('Interval count must be an integer between 1 and 365', ['interval_count']);
    }

    if (typeof input.start_date !== 'string' || !isValidIsoDate(input.start_date)) {
      return fail('Invalid start_date', ['start_date']);
    }

    let end_date: string | null = null;
    if (typeof input.end_date === 'string' && input.end_date.trim()) {
      if (!isValidIsoDate(input.end_date)) {
        return fail('Invalid end_date', ['end_date']);
      }
      if (input.end_date < input.start_date) {
        return fail('End date cannot be earlier than start date', ['end_date']);
      }
      end_date = input.end_date;
    }

    const description = typeof input.description === 'string' ? input.description.trim() : '';

    return ok({
      name,
      transaction_type: input.transaction_type,
      amount_minor: amountRes.data,
      account_id,
      category_id,
      description,
      frequency: input.frequency as RecurringFrequency,
      interval_count,
      start_date: input.start_date,
      end_date,
    });
  },
};

export const updateRecurringRuleSchema: SchemaValidator<{
  name?: string;
  amount_minor?: number;
  account_id?: string;
  category_id?: string;
  description?: string;
  frequency?: RecurringFrequency;
  interval_count?: number;
  end_date?: string | null;
  status?: RecurringStatus;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid recurring rule update payload');
    const out: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return fail('Name cannot be empty', ['name']);
      out.name = name;
    }
    if (input.amount_minor !== undefined) {
      const res = checkPositiveMinorUnits(input.amount_minor, 'amount_minor');
      if (!res.success) return res;
      out.amount_minor = res.data;
    }
    if (input.account_id !== undefined && typeof input.account_id === 'string') {
      out.account_id = input.account_id.trim();
    }
    if (input.category_id !== undefined && typeof input.category_id === 'string') {
      out.category_id = input.category_id.trim();
    }
    if (input.description !== undefined && typeof input.description === 'string') {
      out.description = input.description.trim();
    }
    if (input.frequency !== undefined) {
      if (
        typeof input.frequency !== 'string' ||
        !(RECURRING_FREQUENCIES as readonly string[]).includes(input.frequency)
      ) {
        return fail('Invalid frequency', ['frequency']);
      }
      out.frequency = input.frequency;
    }
    if (input.interval_count !== undefined) {
      const ic = Number(input.interval_count);
      if (!Number.isInteger(ic) || ic < 1 || ic > 365) {
        return fail('Invalid interval_count', ['interval_count']);
      }
      out.interval_count = ic;
    }
    if (input.end_date !== undefined) {
      if (input.end_date === null || input.end_date === '') {
        out.end_date = null;
      } else if (typeof input.end_date === 'string' && isValidIsoDate(input.end_date)) {
        out.end_date = input.end_date;
      } else {
        return fail('Invalid end_date', ['end_date']);
      }
    }
    if (input.status !== undefined) {
      if (
        input.status !== 'active' &&
        input.status !== 'paused' &&
        input.status !== 'cancelled'
      ) {
        return fail('Invalid recurring status', ['status']);
      }
      out.status = input.status;
    }

    return ok(out);
  },
};

export const confirmOccurrenceSchema: SchemaValidator<{
  transaction_date?: string;
  amount_minor?: number;
  notes?: string;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return ok({});
    const out: { transaction_date?: string; amount_minor?: number; notes?: string } = {};
    if (input.transaction_date !== undefined) {
      if (typeof input.transaction_date !== 'string' || !isValidIsoDate(input.transaction_date)) {
        return fail('Invalid transaction_date', ['transaction_date']);
      }
      out.transaction_date = input.transaction_date;
    }
    if (input.amount_minor !== undefined) {
      const res = checkPositiveMinorUnits(input.amount_minor, 'amount_minor');
      if (!res.success) return res;
      out.amount_minor = res.data;
    }
    if (input.notes !== undefined && typeof input.notes === 'string') {
      out.notes = input.notes.trim();
    }
    return ok(out);
  },
};

export const createGoalSchema: SchemaValidator<{
  name: string;
  target_amount_minor: number;
  target_date: string | null;
  account_id: string | null;
  description: string;
  initial_contribution_minor: number;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid savings goal payload');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return fail('Goal name is required', ['name']);

    const targetRes = checkPositiveMinorUnits(input.target_amount_minor, 'target_amount_minor');
    if (!targetRes.success) return targetRes;

    let target_date: string | null = null;
    if (typeof input.target_date === 'string' && input.target_date.trim()) {
      if (!isValidIsoDate(input.target_date)) {
        return fail('Invalid target_date', ['target_date']);
      }
      target_date = input.target_date;
    }

    const account_id =
      typeof input.account_id === 'string' && input.account_id.trim()
        ? input.account_id.trim()
        : null;

    const description = typeof input.description === 'string' ? input.description.trim() : '';

    const initial_contribution_minor =
      typeof input.initial_contribution_minor === 'number' &&
      Number.isInteger(input.initial_contribution_minor) &&
      input.initial_contribution_minor >= 0
        ? input.initial_contribution_minor
        : 0;

    return ok({
      name,
      target_amount_minor: targetRes.data,
      target_date,
      account_id,
      description,
      initial_contribution_minor,
    });
  },
};

export const updateGoalSchema: SchemaValidator<{
  name?: string;
  target_amount_minor?: number;
  target_date?: string | null;
  account_id?: string | null;
  description?: string;
  status?: GoalStatus;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid goal update payload');
    const out: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return fail('Goal name cannot be empty', ['name']);
      out.name = name;
    }
    if (input.target_amount_minor !== undefined) {
      const res = checkPositiveMinorUnits(input.target_amount_minor, 'target_amount_minor');
      if (!res.success) return res;
      out.target_amount_minor = res.data;
    }
    if (input.target_date !== undefined) {
      if (input.target_date === null || input.target_date === '') {
        out.target_date = null;
      } else if (typeof input.target_date === 'string' && isValidIsoDate(input.target_date)) {
        out.target_date = input.target_date;
      } else {
        return fail('Invalid target_date', ['target_date']);
      }
    }
    if (input.account_id !== undefined) {
      out.account_id =
        typeof input.account_id === 'string' && input.account_id.trim()
          ? input.account_id.trim()
          : null;
    }
    if (input.description !== undefined && typeof input.description === 'string') {
      out.description = input.description.trim();
    }
    if (input.status !== undefined) {
      if (
        typeof input.status !== 'string' ||
        !(GOAL_STATUSES as readonly string[]).includes(input.status)
      ) {
        return fail('Invalid goal status', ['status']);
      }
      out.status = input.status;
    }
    return ok(out);
  },
};

export const createGoalContributionSchema: SchemaValidator<{
  amount_minor: number;
  contribution_date: string;
  linked_transaction_id: string | null;
  notes: string;
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid contribution payload');
    const amountRes = checkSignedMinorUnits(input.amount_minor, 'amount_minor');
    if (!amountRes.success) return amountRes;
    if (amountRes.data === 0) {
      return fail('Contribution amount cannot be zero', ['amount_minor']);
    }

    if (typeof input.contribution_date !== 'string' || !isValidIsoDate(input.contribution_date)) {
      return fail('Invalid contribution_date', ['contribution_date']);
    }

    const linked_transaction_id =
      typeof input.linked_transaction_id === 'string' && input.linked_transaction_id.trim()
        ? input.linked_transaction_id.trim()
        : null;

    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';

    return ok({
      amount_minor: amountRes.data,
      contribution_date: input.contribution_date,
      linked_transaction_id,
      notes,
    });
  },
};

export const csvPreviewRequestSchema: SchemaValidator<{
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
    dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
    decimalSeparator: '.' | ',';
    defaultCategoryId?: string;
  };
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid CSV preview payload');
    const csvContent = typeof input.csvContent === 'string' ? input.csvContent : '';
    if (!csvContent.trim()) return fail('CSV content cannot be empty', ['csvContent']);

    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
    if (!accountId) return fail('Target account is required', ['accountId']);

    const delimiter: ',' | ';' | '\t' =
      input.delimiter === ';' || input.delimiter === '\t' ? input.delimiter : ',';

    if (!isObject(input.mapping)) return fail('Column mapping is required', ['mapping']);
    const m = input.mapping;
    const dateColumn = typeof m.dateColumn === 'string' ? m.dateColumn : '';
    const amountColumn = typeof m.amountColumn === 'string' ? m.amountColumn : '';
    const descriptionColumn = typeof m.descriptionColumn === 'string' ? m.descriptionColumn : '';
    if (!dateColumn || !amountColumn || !descriptionColumn) {
      return fail('dateColumn, amountColumn, and descriptionColumn are required', ['mapping']);
    }

    const dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' =
      m.dateFormat === 'DD/MM/YYYY' || m.dateFormat === 'MM/DD/YYYY' ? m.dateFormat : 'YYYY-MM-DD';
    const decimalSeparator: '.' | ',' = m.decimalSeparator === ',' ? ',' : '.';

    return ok({
      csvContent,
      accountId,
      delimiter,
      mapping: {
        dateColumn,
        amountColumn,
        descriptionColumn,
        typeColumn: typeof m.typeColumn === 'string' ? m.typeColumn : undefined,
        categoryColumn: typeof m.categoryColumn === 'string' ? m.categoryColumn : undefined,
        notesColumn: typeof m.notesColumn === 'string' ? m.notesColumn : undefined,
        externalIdColumn: typeof m.externalIdColumn === 'string' ? m.externalIdColumn : undefined,
        dateFormat,
        decimalSeparator,
        defaultCategoryId: typeof m.defaultCategoryId === 'string' ? m.defaultCategoryId : undefined,
      },
    });
  },
};

export const csvCommitRequestSchema: SchemaValidator<{
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
}> = {
  safeParse(input: unknown) {
    if (!isObject(input)) return fail('Invalid CSV commit payload');
    const sourceFilename =
      typeof input.sourceFilename === 'string' && input.sourceFilename.trim()
        ? input.sourceFilename.trim()
        : 'import.csv';
    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
    if (!accountId) return fail('accountId is required', ['accountId']);

    const includeDuplicates = Boolean(input.includeDuplicates);
    if (!Array.isArray(input.rows)) return fail('rows array is required', ['rows']);

    const parsedRows = [];
    for (const r of input.rows) {
      if (!isObject(r)) return fail('Invalid row object in rows');
      if (typeof r.transaction_date !== 'string' || !isValidIsoDate(r.transaction_date)) {
        return fail('Invalid transaction_date in import row');
      }
      if (r.transaction_type !== 'income' && r.transaction_type !== 'expense') {
        return fail('Invalid transaction_type in import row');
      }
      const amtRes = checkPositiveMinorUnits(r.amount_minor, 'amount_minor');
      if (!amtRes.success) return amtRes;
      if (typeof r.category_id !== 'string' || !r.category_id.trim()) {
        return fail('Invalid category_id in import row');
      }
      parsedRows.push({
        rowIndex: typeof r.rowIndex === 'number' ? r.rowIndex : 0,
        skip: Boolean(r.skip),
        isProbableDuplicate: Boolean(r.isProbableDuplicate),
        transaction_date: r.transaction_date,
        transaction_type: r.transaction_type as 'income' | 'expense',
        amount_minor: amtRes.data,
        category_id: r.category_id.trim(),
        description: typeof r.description === 'string' ? r.description.trim() : '',
        notes: typeof r.notes === 'string' ? r.notes.trim() : '',
        import_external_id:
          typeof r.import_external_id === 'string' && r.import_external_id.trim()
            ? r.import_external_id.trim()
            : null,
      });
    }

    return ok({
      sourceFilename,
      accountId,
      includeDuplicates,
      rows: parsedRows,
    });
  },
};
