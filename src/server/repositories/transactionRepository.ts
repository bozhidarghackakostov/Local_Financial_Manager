import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type {
  CategoryType,
  PaginatedTransactions,
  TransactionRecord,
  TransactionType,
} from '../../shared/types/index.ts';

interface RawTransactionRow {
  id: string;
  transaction_type: TransactionType;
  transaction_date: string;
  amount_minor: number;
  currency: string;
  account_id: string;
  account_name: string;
  destination_account_id: string | null;
  destination_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_type: CategoryType | null;
  description: string;
  notes: string;
  is_refund: number;
  refunded_transaction_id: string | null;
  import_batch_id: string | null;
  import_external_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  tags_csv: string | null;
}

const TRANSACTION_SELECT_SQL = `
  SELECT
    t.id,
    t.transaction_type,
    t.transaction_date,
    t.amount_minor,
    t.currency,
    t.account_id,
    a.name AS account_name,
    t.destination_account_id,
    da.name AS destination_account_name,
    t.category_id,
    c.name AS category_name,
    c.category_type AS category_type,
    t.description,
    t.notes,
    t.is_refund,
    t.refunded_transaction_id,
    t.import_batch_id,
    t.import_external_id,
    t.created_at,
    t.updated_at,
    t.deleted_at,
    (
      SELECT GROUP_CONCAT(tg.name, ',')
      FROM transaction_tags tt
      JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.transaction_id = t.id
    ) AS tags_csv
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts da ON da.id = t.destination_account_id
  LEFT JOIN categories c ON c.id = t.category_id
`;

function mapTransactionRow(row: RawTransactionRow): TransactionRecord {
  const tags = row.tags_csv
    ? row.tags_csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    id: row.id,
    transaction_type: row.transaction_type,
    transaction_date: row.transaction_date,
    amount_minor: Number(row.amount_minor),
    currency: row.currency,
    account_id: row.account_id,
    account_name: row.account_name,
    destination_account_id: row.destination_account_id,
    destination_account_name: row.destination_account_name,
    category_id: row.category_id,
    category_name: row.category_name,
    category_type: row.category_type,
    description: row.description,
    notes: row.notes,
    tags,
    is_refund: Boolean(row.is_refund),
    refunded_transaction_id: row.refunded_transaction_id,
    import_batch_id: row.import_batch_id,
    import_external_id: row.import_external_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

export interface TransactionQueryFilters {
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
}

export class TransactionRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findById(id: string): TransactionRecord | null {
    const row = this.dbManager.db
      .prepare(`${TRANSACTION_SELECT_SQL} WHERE t.id = ?`)
      .get(id) as unknown as RawTransactionRow | undefined;
    return row ? mapTransactionRow(row) : null;
  }

  public query(filters: TransactionQueryFilters = {}): PaginatedTransactions {
    const { whereSql, params } = this.buildWhereClause(filters);
    const sortBy = filters.sortBy ?? 'date';
    const sortOrder = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const sortColumnMap: Record<string, string> = {
      date: 't.transaction_date',
      amount: 't.amount_minor',
      account: 'a.name',
      category: 'COALESCE(c.name, "")',
      updated_at: 't.updated_at',
    };
    const primarySortCol = sortColumnMap[sortBy] ?? 't.transaction_date';
    const orderBySql = `ORDER BY ${primarySortCol} ${sortOrder}, t.created_at ${sortOrder}`;

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const countRow = this.dbManager.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts da ON da.id = t.destination_account_id
         LEFT JOIN categories c ON c.id = t.category_id
         ${whereSql}`
      )
      .get(...params) as { total: number };

    const total = Number(countRow.total);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const rows = this.dbManager.db
      .prepare(`${TRANSACTION_SELECT_SQL} ${whereSql} ${orderBySql} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset) as unknown as RawTransactionRow[];

    return {
      items: rows.map(mapTransactionRow),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public findAllMatching(filters: TransactionQueryFilters = {}): TransactionRecord[] {
    const { whereSql, params } = this.buildWhereClause(filters);
    const rows = this.dbManager.db
      .prepare(`${TRANSACTION_SELECT_SQL} ${whereSql} ORDER BY t.transaction_date DESC, t.created_at DESC`)
      .all(...params) as unknown as RawTransactionRow[];
    return rows.map(mapTransactionRow);
  }

  private buildWhereClause(filters: TransactionQueryFilters): {
    whereSql: string;
    params: Array<string | number>;
  } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    const status = filters.status ?? 'active';
    if (status === 'active') {
      conditions.push('t.deleted_at IS NULL');
    } else if (status === 'trashed') {
      conditions.push('t.deleted_at IS NOT NULL');
    }

    if (filters.type) {
      conditions.push('t.transaction_type = ?');
      params.push(filters.type);
    }

    if (filters.accountId) {
      conditions.push('(t.account_id = ? OR t.destination_account_id = ?)');
      params.push(filters.accountId, filters.accountId);
    }

    if (filters.categoryId) {
      conditions.push('t.category_id = ?');
      params.push(filters.categoryId);
    }

    if (filters.startDate) {
      conditions.push('t.transaction_date >= ?');
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push('t.transaction_date <= ?');
      params.push(filters.endDate);
    }

    if (filters.search && filters.search.trim()) {
      const likeTerm = `%${filters.search.trim()}%`;
      conditions.push(`(
        t.description LIKE ?
        OR t.notes LIKE ?
        OR a.name LIKE ?
        OR COALESCE(da.name, '') LIKE ?
        OR COALESCE(c.name, '') LIKE ?
        OR EXISTS (
          SELECT 1 FROM transaction_tags tt
          JOIN tags tg ON tg.id = tt.tag_id
          WHERE tt.transaction_id = t.id AND tg.name LIKE ?
        )
      )`);
      params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereSql, params };
  }

  public create(data: {
    id?: string;
    transaction_type: TransactionType;
    transaction_date: string;
    amount_minor: number;
    currency: string;
    account_id: string;
    destination_account_id: string | null;
    category_id: string | null;
    description: string;
    notes: string;
    tags: string[];
    is_refund: boolean;
    refunded_transaction_id: string | null;
    import_batch_id?: string | null;
    import_external_id?: string | null;
  }): TransactionRecord {
    const id = data.id ?? `tx-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.dbManager.withTransaction((db) => {
      db.prepare(
        `INSERT INTO transactions (
          id, transaction_type, transaction_date, amount_minor, currency,
          account_id, destination_account_id, category_id,
          description, notes, is_refund, refunded_transaction_id,
          import_batch_id, import_external_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        id,
        data.transaction_type,
        data.transaction_date,
        data.amount_minor,
        data.currency,
        data.account_id,
        data.destination_account_id,
        data.category_id,
        data.description,
        data.notes,
        data.is_refund ? 1 : 0,
        data.refunded_transaction_id,
        data.import_batch_id ?? null,
        data.import_external_id ?? null,
        now,
        now
      );

      this.syncTransactionTags(id, data.tags, now);
    });

    return this.findById(id)!;
  }

  public update(
    id: string,
    data: {
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
    }
  ): TransactionRecord {
    const now = new Date().toISOString();

    this.dbManager.withTransaction((db) => {
      db.prepare(
        `UPDATE transactions
         SET transaction_type = ?,
             transaction_date = ?,
             amount_minor = ?,
             account_id = ?,
             destination_account_id = ?,
             category_id = ?,
             description = ?,
             notes = ?,
             is_refund = ?,
             refunded_transaction_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        data.transaction_type,
        data.transaction_date,
        data.amount_minor,
        data.account_id,
        data.destination_account_id,
        data.category_id,
        data.description,
        data.notes,
        data.is_refund ? 1 : 0,
        data.refunded_transaction_id,
        now,
        id
      );

      this.syncTransactionTags(id, data.tags, now);
    });

    return this.findById(id)!;
  }

  public softDelete(id: string): TransactionRecord {
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id);
    return this.findById(id)!;
  }

  public restore(id: string): TransactionRecord {
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare('UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, id);
    return this.findById(id)!;
  }

  public hardDelete(id: string): void {
    this.dbManager.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  }

  private syncTransactionTags(transactionId: string, tags: string[], now: string): void {
    const db = this.dbManager.db;
    db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(transactionId);

    const uniqueNames = Array.from(
      new Set(
        tags
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );

    for (const tagName of uniqueNames) {
      let tagRow = db
        .prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)')
        .get(tagName) as { id: string } | undefined;

      if (!tagRow) {
        const newTagId = `tag-${crypto.randomUUID()}`;
        db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').run(newTagId, tagName, now);
        tagRow = { id: newTagId };
      }

      db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(
        transactionId,
        tagRow.id
      );
    }
  }
}
