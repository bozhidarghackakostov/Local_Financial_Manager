import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type {
  OccurrenceStatus,
  RecurringFrequency,
  RecurringOccurrence,
  RecurringRule,
  RecurringStatus,
} from '../../shared/types/index.ts';
import { addCalendarDays, getTodayIsoDate } from '../../shared/utils/dates.ts';

interface RawRecurringRuleRow {
  id: string;
  name: string;
  transaction_type: 'income' | 'expense';
  amount_minor: number;
  account_id: string;
  account_name: string;
  category_id: string;
  category_name: string;
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

interface RawOccurrenceRow {
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
  linked_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

const RULE_SELECT_SQL = `
  SELECT
    r.id,
    r.name,
    r.transaction_type,
    r.amount_minor,
    r.account_id,
    a.name AS account_name,
    r.category_id,
    c.name AS category_name,
    r.description,
    r.frequency,
    r.interval_count,
    r.start_date,
    r.end_date,
    r.next_due_date,
    r.status,
    r.created_at,
    r.updated_at
  FROM recurring_rules r
  JOIN accounts a ON a.id = r.account_id
  JOIN categories c ON c.id = r.category_id
`;

const OCCURRENCE_SELECT_SQL = `
  SELECT
    o.id,
    o.recurring_rule_id,
    r.name AS rule_name,
    r.transaction_type,
    r.account_id,
    a.name AS account_name,
    r.category_id,
    c.name AS category_name,
    o.due_date,
    o.expected_amount_minor,
    o.status,
    o.linked_transaction_id,
    o.created_at,
    o.updated_at
  FROM recurring_occurrences o
  JOIN recurring_rules r ON r.id = o.recurring_rule_id
  JOIN accounts a ON a.id = r.account_id
  JOIN categories c ON c.id = r.category_id
`;

function mapRuleRow(row: RawRecurringRuleRow): RecurringRule {
  return {
    id: row.id,
    name: row.name,
    transaction_type: row.transaction_type,
    amount_minor: Number(row.amount_minor),
    account_id: row.account_id,
    account_name: row.account_name,
    category_id: row.category_id,
    category_name: row.category_name,
    description: row.description,
    frequency: row.frequency,
    interval_count: Number(row.interval_count),
    start_date: row.start_date,
    end_date: row.end_date,
    next_due_date: row.next_due_date,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOccurrenceRow(row: RawOccurrenceRow, referenceDate: string): RecurringOccurrence {
  const dueSoonThreshold = addCalendarDays(referenceDate, 7);
  let urgency: RecurringOccurrence['urgency'] = 'upcoming';

  if (row.status !== 'pending') {
    urgency = 'resolved';
  } else if (row.due_date < referenceDate) {
    urgency = 'overdue';
  } else if (row.due_date <= dueSoonThreshold) {
    urgency = 'due_soon';
  }

  return {
    id: row.id,
    recurring_rule_id: row.recurring_rule_id,
    rule_name: row.rule_name,
    transaction_type: row.transaction_type,
    account_id: row.account_id,
    account_name: row.account_name,
    category_id: row.category_id,
    category_name: row.category_name,
    due_date: row.due_date,
    expected_amount_minor: Number(row.expected_amount_minor),
    status: row.status,
    urgency,
    linked_transaction_id: row.linked_transaction_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class RecurringRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findAllRules(options: { status?: RecurringStatus } = {}): RecurringRule[] {
    const where = options.status ? 'WHERE r.status = ?' : '';
    const params = options.status ? [options.status] : [];
    const rows = this.dbManager.db
      .prepare(`${RULE_SELECT_SQL} ${where} ORDER BY CASE WHEN r.status = 'active' THEN 0 ELSE 1 END, r.next_due_date ASC, r.name ASC`)
      .all(...params) as unknown as RawRecurringRuleRow[];
    return rows.map(mapRuleRow);
  }

  public findRuleById(id: string): RecurringRule | null {
    const row = this.dbManager.db
      .prepare(`${RULE_SELECT_SQL} WHERE r.id = ?`)
      .get(id) as unknown as RawRecurringRuleRow | undefined;
    return row ? mapRuleRow(row) : null;
  }

  public createRule(data: {
    id?: string;
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
    next_due_date: string;
  }): RecurringRule {
    const id = data.id ?? `rec-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO recurring_rules (
          id, name, transaction_type, amount_minor, account_id, category_id,
          description, frequency, interval_count, start_date, end_date,
          next_due_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        id,
        data.name,
        data.transaction_type,
        data.amount_minor,
        data.account_id,
        data.category_id,
        data.description,
        data.frequency,
        data.interval_count,
        data.start_date,
        data.end_date,
        data.next_due_date,
        now,
        now
      );

    return this.findRuleById(id)!;
  }

  public updateRule(
    id: string,
    data: Partial<{
      name: string;
      amount_minor: number;
      account_id: string;
      category_id: string;
      description: string;
      frequency: RecurringFrequency;
      interval_count: number;
      end_date: string | null;
      next_due_date: string;
      status: RecurringStatus;
    }>
  ): RecurringRule {
    const current = this.findRuleById(id);
    if (!current) {
      throw new Error(`Recurring rule ${id} not found`);
    }
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE recurring_rules
         SET name = ?,
             amount_minor = ?,
             account_id = ?,
             category_id = ?,
             description = ?,
             frequency = ?,
             interval_count = ?,
             end_date = ?,
             next_due_date = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        data.amount_minor ?? current.amount_minor,
        data.account_id ?? current.account_id,
        data.category_id ?? current.category_id,
        data.description ?? current.description,
        data.frequency ?? current.frequency,
        data.interval_count ?? current.interval_count,
        data.end_date !== undefined ? data.end_date : current.end_date,
        data.next_due_date ?? current.next_due_date,
        data.status ?? current.status,
        now,
        id
      );

    return this.findRuleById(id)!;
  }

  public insertOccurrenceIgnoreDuplicate(data: {
    recurring_rule_id: string;
    due_date: string;
    expected_amount_minor: number;
  }): boolean {
    const id = `occ-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const res = this.dbManager.db
      .prepare(
        `INSERT OR IGNORE INTO recurring_occurrences (
          id, recurring_rule_id, due_date, expected_amount_minor, status, linked_transaction_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)`
      )
      .run(id, data.recurring_rule_id, data.due_date, data.expected_amount_minor, now, now);

    return Number(res.changes) > 0;
  }

  public findOccurrences(
    options: {
      ruleId?: string;
      status?: OccurrenceStatus;
      maxDueDate?: string;
      referenceDate?: string;
    } = {}
  ): RecurringOccurrence[] {
    const refDate = options.referenceDate ?? getTodayIsoDate();
    const conditions: string[] = [];
    const params: string[] = [];

    if (options.ruleId) {
      conditions.push('o.recurring_rule_id = ?');
      params.push(options.ruleId);
    }
    if (options.status) {
      conditions.push('o.status = ?');
      params.push(options.status);
    }
    if (options.maxDueDate) {
      conditions.push('o.due_date <= ?');
      params.push(options.maxDueDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.dbManager.db
      .prepare(`${OCCURRENCE_SELECT_SQL} ${where} ORDER BY o.due_date ASC, r.name ASC`)
      .all(...params) as unknown as RawOccurrenceRow[];

    return rows.map((r) => mapOccurrenceRow(r, refDate));
  }

  public findOccurrenceById(id: string, referenceDate: string = getTodayIsoDate()): RecurringOccurrence | null {
    const row = this.dbManager.db
      .prepare(`${OCCURRENCE_SELECT_SQL} WHERE o.id = ?`)
      .get(id) as unknown as RawOccurrenceRow | undefined;
    return row ? mapOccurrenceRow(row, referenceDate) : null;
  }

  public updateOccurrenceStatus(
    id: string,
    status: OccurrenceStatus,
    linkedTransactionId: string | null = null
  ): RecurringOccurrence {
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE recurring_occurrences
         SET status = ?, linked_transaction_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, linkedTransactionId, now, id);
    return this.findOccurrenceById(id)!;
  }
}
