import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type { Account, AccountStatus, AccountType } from '../../shared/types/index.ts';

interface RawAccountRow {
  id: string;
  name: string;
  account_type: AccountType;
  opening_balance_minor: number;
  currency: string;
  description: string;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
  inflow_minor: number;
  outflow_minor: number;
  transaction_count: number;
}

const ACCOUNT_WITH_BALANCES_SQL = `
  SELECT
    a.id,
    a.name,
    a.account_type,
    a.opening_balance_minor,
    a.currency,
    a.description,
    a.status,
    a.created_at,
    a.updated_at,
    COALESCE((
      SELECT SUM(t.amount_minor)
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND (
          (t.account_id = a.id AND t.transaction_type = 'income')
          OR (t.account_id = a.id AND t.transaction_type = 'expense' AND t.is_refund = 1)
          OR (t.destination_account_id = a.id AND t.transaction_type = 'transfer')
        )
    ), 0) AS inflow_minor,
    COALESCE((
      SELECT SUM(t.amount_minor)
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND (
          (t.account_id = a.id AND t.transaction_type = 'expense' AND t.is_refund = 0)
          OR (t.account_id = a.id AND t.transaction_type = 'transfer')
        )
    ), 0) AS outflow_minor,
    COALESCE((
      SELECT COUNT(*)
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND (t.account_id = a.id OR t.destination_account_id = a.id)
    ), 0) AS transaction_count
  FROM accounts a
`;

function mapAccountRow(row: RawAccountRow): Account {
  const opening = Number(row.opening_balance_minor);
  const inflow = Number(row.inflow_minor);
  const outflow = Number(row.outflow_minor);
  const net = inflow - outflow;
  return {
    id: row.id,
    name: row.name,
    account_type: row.account_type,
    opening_balance_minor: opening,
    current_balance_minor: opening + net,
    inflow_minor: inflow,
    outflow_minor: outflow,
    net_movement_minor: net,
    transaction_count: Number(row.transaction_count),
    currency: row.currency,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AccountRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findAll(options: { includeArchived?: boolean } = {}): Account[] {
    const includeArchived = options.includeArchived ?? true;
    const whereClause = includeArchived ? '' : "WHERE a.status = 'active'";
    const sql = `${ACCOUNT_WITH_BALANCES_SQL} ${whereClause} ORDER BY CASE WHEN a.status = 'active' THEN 0 ELSE 1 END, a.name ASC`;
    const rows = this.dbManager.db.prepare(sql).all() as unknown as RawAccountRow[];
    return rows.map(mapAccountRow);
  }

  public findById(id: string): Account | null {
    const sql = `${ACCOUNT_WITH_BALANCES_SQL} WHERE a.id = ?`;
    const row = this.dbManager.db.prepare(sql).get(id) as unknown as RawAccountRow | undefined;
    return row ? mapAccountRow(row) : null;
  }

  public findByName(name: string): Account | null {
    const sql = `${ACCOUNT_WITH_BALANCES_SQL} WHERE LOWER(a.name) = LOWER(?)`;
    const row = this.dbManager.db.prepare(sql).get(name) as unknown as RawAccountRow | undefined;
    return row ? mapAccountRow(row) : null;
  }

  public create(data: {
    id?: string;
    name: string;
    account_type: AccountType;
    opening_balance_minor: number;
    currency: string;
    description: string;
  }): Account {
    const id = data.id ?? `acc-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO accounts (id, name, account_type, opening_balance_minor, currency, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, data.name, data.account_type, data.opening_balance_minor, data.currency, data.description, now, now);

    return this.findById(id)!;
  }

  public update(
    id: string,
    data: Partial<{
      name: string;
      account_type: AccountType;
      opening_balance_minor: number;
      description: string;
      status: AccountStatus;
    }>
  ): Account {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Account ${id} not found`);
    }
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE accounts
         SET name = ?,
             account_type = ?,
             opening_balance_minor = ?,
             description = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        data.account_type ?? current.account_type,
        data.opening_balance_minor ?? current.opening_balance_minor,
        data.description ?? current.description,
        data.status ?? current.status,
        now,
        id
      );

    return this.findById(id)!;
  }

  public countReferences(id: string): number {
    const txCount = this.dbManager.db
      .prepare('SELECT COUNT(*) as c FROM transactions WHERE account_id = ? OR destination_account_id = ?')
      .get(id, id) as { c: number };
    const recCount = this.dbManager.db
      .prepare('SELECT COUNT(*) as c FROM recurring_rules WHERE account_id = ?')
      .get(id) as { c: number };
    return Number(txCount.c) + Number(recCount.c);
  }

  public delete(id: string): void {
    this.dbManager.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }
}
