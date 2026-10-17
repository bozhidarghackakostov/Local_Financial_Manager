import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type { Category, CategoryType } from '../../shared/types/index.ts';

interface RawCategoryRow {
  id: string;
  name: string;
  category_type: CategoryType;
  parent_id: string | null;
  parent_name: string | null;
  display_order: number;
  is_archived: number;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORY_SELECT_SQL = `
  SELECT
    c.id,
    c.name,
    c.category_type,
    c.parent_id,
    p.name AS parent_name,
    c.display_order,
    c.is_archived,
    c.created_at,
    c.updated_at,
    COALESCE((
      SELECT COUNT(*)
      FROM transactions t
      WHERE t.category_id = c.id AND t.deleted_at IS NULL
    ), 0) AS transaction_count
  FROM categories c
  LEFT JOIN categories p ON p.id = c.parent_id
`;

function mapCategoryRow(row: RawCategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    category_type: row.category_type,
    parent_id: row.parent_id,
    parent_name: row.parent_name,
    display_order: Number(row.display_order),
    is_archived: Boolean(row.is_archived),
    transaction_count: Number(row.transaction_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class CategoryRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public findAll(options: { type?: CategoryType; includeArchived?: boolean } = {}): Category[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (options.type) {
      conditions.push('c.category_type = ?');
      params.push(options.type);
    }
    if (options.includeArchived === false) {
      conditions.push('c.is_archived = 0');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${CATEGORY_SELECT_SQL} ${where} ORDER BY c.category_type ASC, c.is_archived ASC, c.display_order ASC, c.name ASC`;
    const rows = this.dbManager.db.prepare(sql).all(...params) as unknown as RawCategoryRow[];
    return rows.map(mapCategoryRow);
  }

  public findById(id: string): Category | null {
    const row = this.dbManager.db
      .prepare(`${CATEGORY_SELECT_SQL} WHERE c.id = ?`)
      .get(id) as unknown as RawCategoryRow | undefined;
    return row ? mapCategoryRow(row) : null;
  }

  public findByNameAndType(name: string, type: CategoryType): Category | null {
    const row = this.dbManager.db
      .prepare(`${CATEGORY_SELECT_SQL} WHERE LOWER(c.name) = LOWER(?) AND c.category_type = ?`)
      .get(name, type) as unknown as RawCategoryRow | undefined;
    return row ? mapCategoryRow(row) : null;
  }

  public create(data: {
    id?: string;
    name: string;
    category_type: CategoryType;
    parent_id: string | null;
    display_order: number;
  }): Category {
    const id = data.id ?? `cat-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `INSERT INTO categories (id, name, category_type, parent_id, display_order, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, data.name, data.category_type, data.parent_id, data.display_order, now, now);

    return this.findById(id)!;
  }

  public update(
    id: string,
    data: Partial<{
      name: string;
      parent_id: string | null;
      display_order: number;
      is_archived: boolean;
    }>
  ): Category {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Category ${id} not found`);
    }
    const now = new Date().toISOString();
    this.dbManager.db
      .prepare(
        `UPDATE categories
         SET name = ?,
             parent_id = ?,
             display_order = ?,
             is_archived = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        data.parent_id !== undefined ? data.parent_id : current.parent_id,
        data.display_order ?? current.display_order,
        data.is_archived !== undefined ? (data.is_archived ? 1 : 0) : current.is_archived ? 1 : 0,
        now,
        id
      );

    return this.findById(id)!;
  }

  public countReferences(id: string): number {
    const tx = this.dbManager.db
      .prepare('SELECT COUNT(*) as c FROM transactions WHERE category_id = ?')
      .get(id) as { c: number };
    const b = this.dbManager.db
      .prepare('SELECT COUNT(*) as c FROM budgets WHERE category_id = ?')
      .get(id) as { c: number };
    const r = this.dbManager.db
      .prepare('SELECT COUNT(*) as c FROM recurring_rules WHERE category_id = ?')
      .get(id) as { c: number };
    return Number(tx.c) + Number(b.c) + Number(r.c);
  }

  public deleteWithOptionalReassign(id: string, reassignToCategoryId?: string): void {
    this.dbManager.withTransaction((db) => {
      if (reassignToCategoryId) {
        db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(reassignToCategoryId, id);
        db.prepare('UPDATE budgets SET category_id = ? WHERE category_id = ?').run(reassignToCategoryId, id);
        db.prepare('UPDATE recurring_rules SET category_id = ? WHERE category_id = ?').run(reassignToCategoryId, id);
      }
      db.prepare('UPDATE categories SET parent_id = NULL WHERE parent_id = ?').run(id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
  }
}
