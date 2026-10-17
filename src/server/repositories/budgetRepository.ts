import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type { BudgetStatus, BudgetWithActuals } from '../../shared/types/index.ts';
import { calculatePercentage } from '../../shared/utils/money.ts';

interface RawBudgetRow {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  period_month: string;
  planned_amount_minor: number;
  notes: string;
  status: BudgetStatus;
  created_at: string;
  updated_at: string;
  actual_minor: number;
}

const BUDGET_SELECT_SQL = `
  SELECT
    b.id,
    b.name,
    b.category_id,
    c.name AS category_name,
    b.period_month,
    b.planned_amount_minor,
    b.notes,
    b.status,
    b.created_at,
    b.updated_at,
    COALESCE((
      SELECT SUM(
        CASE WHEN t.is_refund = 1 THEN -t.amount_minor ELSE t.amount_minor END
      )
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND t.transaction_type = 'expense'
        AND substr(t.transaction_date, 1, 7) = b.period_month
        AND (
          b.category_id IS NULL
          OR t.category_id = b.category_id
          OR t.category_id IN (SELECT sub.id FROM categories sub WHERE sub.parent_id = b.category_id)
        )
    ), 0) AS actual_minor
  FROM budgets b
  LEFT JOIN categories c ON c.id = b.category_id
`;

function mapBudgetRow(row: RawBudgetRow): BudgetWithActuals {
  const planned = Number(row.planned_amount_minor);
  const actual = Number(row.actual_minor);
  const remaining = planned - actual;
  const percentage = calculatePercentage(Math.max(0, actual), planned);

  return {
    id: row.id,
    name: row.name,
    category_id: row.category_id,
    category_name: row.category_name ?? 'Overall Monthly Budget',
    period_month: row.period_month,
    planned_amount_minor: planned,
    actual_minor: actual,
    remaining_minor: remaining,
    percentage_used: percentage,
    is_overspent: actual > planned,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class BudgetRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findAll(options: { periodMonth?: string; includeArchived?: boolean } = {}): BudgetWithActuals[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (options.periodMonth) {
      conditions.push('b.period_month = ?');
      params.push(options.periodMonth);
    }
    if (options.includeArchived === false) {
      conditions.push("b.status = 'active'");
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${BUDGET_SELECT_SQL} ${whereSql} ORDER BY b.period_month DESC, CASE WHEN b.category_id IS NULL THEN 0 ELSE 1 END, b.name ASC`;
    const rows = this.dbManager.db.prepare(sql).all(...params) as unknown as RawBudgetRow[];
    return rows.map(mapBudgetRow);
  }

  public findById(id: string): BudgetWithActuals | null {
    const row = this.dbManager.db
      .prepare(`${BUDGET_SELECT_SQL} WHERE b.id = ?`)
      .get(id) as unknown as RawBudgetRow | undefined;
    return row ? mapBudgetRow(row) : null;
  }

  public findByPeriodAndCategory(periodMonth: string, categoryId: string | null): BudgetWithActuals | null {
    const sql =
      categoryId === null
        ? `${BUDGET_SELECT_SQL} WHERE b.period_month = ? AND b.category_id IS NULL`
        : `${BUDGET_SELECT_SQL} WHERE b.period_month = ? AND b.category_id = ?`;
    const row = (
      categoryId === null
        ? this.dbManager.db.prepare(sql).get(periodMonth)
        : this.dbManager.db.prepare(sql).get(periodMonth, categoryId)
    ) as unknown as RawBudgetRow | undefined;
    return row ? mapBudgetRow(row) : null;
  }

  public create(data: {
    id?: string;
    name: string;
    category_id: string | null;
    period_month: string;
    planned_amount_minor: number;
    notes: string;
  }): BudgetWithActuals {
    const id = data.id ?? `bdg-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO budgets (id, name, category_id, period_month, planned_amount_minor, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, data.name, data.category_id, data.period_month, data.planned_amount_minor, data.notes, now, now);

    return this.findById(id)!;
  }

  public update(
    id: string,
    data: Partial<{
      name: string;
      planned_amount_minor: number;
      notes: string;
      status: BudgetStatus;
    }>
  ): BudgetWithActuals {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Budget ${id} not found`);
    }
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE budgets
         SET name = ?,
             planned_amount_minor = ?,
             notes = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        data.planned_amount_minor ?? current.planned_amount_minor,
        data.notes ?? current.notes,
        data.status ?? current.status,
        now,
        id
      );

    return this.findById(id)!;
  }

  public delete(id: string): void {
    this.dbManager.db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  }
}
