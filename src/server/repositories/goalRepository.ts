import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type { GoalStatus, SavingsContribution, SavingsGoal } from '../../shared/types/index.ts';
import { calculatePercentage } from '../../shared/utils/money.ts';

interface RawGoalRow {
  id: string;
  name: string;
  target_amount_minor: number;
  target_date: string | null;
  account_id: string | null;
  account_name: string | null;
  description: string;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
  current_amount_minor: number;
  contributions_count: number;
}

const GOAL_SELECT_SQL = `
  SELECT
    g.id,
    g.name,
    g.target_amount_minor,
    g.target_date,
    g.account_id,
    a.name AS account_name,
    g.description,
    g.status,
    g.created_at,
    g.updated_at,
    COALESCE((
      SELECT SUM(sc.amount_minor)
      FROM savings_contributions sc
      WHERE sc.goal_id = g.id
    ), 0) AS current_amount_minor,
    COALESCE((
      SELECT COUNT(*)
      FROM savings_contributions sc
      WHERE sc.goal_id = g.id
    ), 0) AS contributions_count
  FROM savings_goals g
  LEFT JOIN accounts a ON a.id = g.account_id
`;

function mapGoalRow(row: RawGoalRow): SavingsGoal {
  const target = Number(row.target_amount_minor);
  const current = Number(row.current_amount_minor);
  const remaining = Math.max(0, target - current);
  const percentage = calculatePercentage(Math.max(0, current), target);

  return {
    id: row.id,
    name: row.name,
    target_amount_minor: target,
    current_amount_minor: current,
    remaining_amount_minor: remaining,
    percentage_achieved: percentage,
    target_date: row.target_date,
    account_id: row.account_id,
    account_name: row.account_name,
    description: row.description,
    status: row.status,
    contributions_count: Number(row.contributions_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class GoalRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findAll(options: { status?: GoalStatus } = {}): SavingsGoal[] {
    const where = options.status ? 'WHERE g.status = ?' : '';
    const params = options.status ? [options.status] : [];
    const rows = this.dbManager.db
      .prepare(
        `${GOAL_SELECT_SQL} ${where} ORDER BY CASE WHEN g.status = 'active' THEN 0 WHEN g.status = 'completed' THEN 1 ELSE 2 END, COALESCE(g.target_date, '9999-12-31') ASC, g.name ASC`
      )
      .all(...params) as unknown as RawGoalRow[];
    return rows.map(mapGoalRow);
  }

  public findById(id: string): SavingsGoal | null {
    const row = this.dbManager.db
      .prepare(`${GOAL_SELECT_SQL} WHERE g.id = ?`)
      .get(id) as unknown as RawGoalRow | undefined;
    return row ? mapGoalRow(row) : null;
  }

  public findByName(name: string): SavingsGoal | null {
    const row = this.dbManager.db
      .prepare(`${GOAL_SELECT_SQL} WHERE LOWER(g.name) = LOWER(?)`)
      .get(name) as unknown as RawGoalRow | undefined;
    return row ? mapGoalRow(row) : null;
  }

  public create(data: {
    id?: string;
    name: string;
    target_amount_minor: number;
    target_date: string | null;
    account_id: string | null;
    description: string;
  }): SavingsGoal {
    const id = data.id ?? `goal-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO savings_goals (
          id, name, target_amount_minor, target_date, account_id, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, data.name, data.target_amount_minor, data.target_date, data.account_id, data.description, now, now);

    return this.findById(id)!;
  }

  public update(
    id: string,
    data: Partial<{
      name: string;
      target_amount_minor: number;
      target_date: string | null;
      account_id: string | null;
      description: string;
      status: GoalStatus;
    }>
  ): SavingsGoal {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Goal ${id} not found`);
    }
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE savings_goals
         SET name = ?,
             target_amount_minor = ?,
             target_date = ?,
             account_id = ?,
             description = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        data.target_amount_minor ?? current.target_amount_minor,
        data.target_date !== undefined ? data.target_date : current.target_date,
        data.account_id !== undefined ? data.account_id : current.account_id,
        data.description ?? current.description,
        data.status ?? current.status,
        now,
        id
      );

    return this.findById(id)!;
  }

  public delete(id: string): void {
    this.dbManager.db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id);
  }

  public listContributions(goalId: string): SavingsContribution[] {
    const rows = this.dbManager.db
      .prepare(
        `SELECT id, goal_id, amount_minor, contribution_date, linked_transaction_id, notes, created_at
         FROM savings_contributions
         WHERE goal_id = ?
         ORDER BY contribution_date DESC, created_at DESC`
      )
      .all(goalId) as unknown as SavingsContribution[];
    return rows.map((r) => ({
      ...r,
      amount_minor: Number(r.amount_minor),
    }));
  }

  public addContribution(data: {
    id?: string;
    goal_id: string;
    amount_minor: number;
    contribution_date: string;
    linked_transaction_id: string | null;
    notes: string;
  }): SavingsContribution {
    const id = data.id ?? `contrib-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO savings_contributions (id, goal_id, amount_minor, contribution_date, linked_transaction_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, data.goal_id, data.amount_minor, data.contribution_date, data.linked_transaction_id, data.notes, now);

    return {
      id,
      goal_id: data.goal_id,
      amount_minor: data.amount_minor,
      contribution_date: data.contribution_date,
      linked_transaction_id: data.linked_transaction_id,
      notes: data.notes,
      created_at: now,
    };
  }

  public deleteContribution(contributionId: string): void {
    this.dbManager.db.prepare('DELETE FROM savings_contributions WHERE id = ?').run(contributionId);
  }
}
