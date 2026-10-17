import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseManager } from './connection.ts';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../../../database/seed/default_categories.ts';

export interface MigrationResult {
  applied: string[];
  totalApplied: number;
}

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'current', 'savings', 'credit_card', 'other')),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('income', 'expense')),
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, category_type)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_filename TEXT NOT NULL,
  import_date TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'transfer')),
  transaction_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_refund INTEGER NOT NULL DEFAULT 0 CHECK (is_refund IN (0, 1)),
  refunded_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  import_batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL,
  import_external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (transaction_type = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id != account_id AND category_id IS NULL AND is_refund = 0)
    OR
    (transaction_type IN ('income', 'expense') AND destination_account_id IS NULL AND category_id IS NOT NULL)
  ),
  CHECK (
    (is_refund = 0) OR (is_refund = 1 AND transaction_type = 'expense')
  )
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL,
  planned_amount_minor INTEGER NOT NULL CHECK (planned_amount_minor > 0),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_occurrences (
  id TEXT PRIMARY KEY,
  recurring_rule_id TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  expected_amount_minor INTEGER NOT NULL CHECK (expected_amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'skipped')),
  linked_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (recurring_rule_id, due_date)
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  target_amount_minor INTEGER NOT NULL CHECK (target_amount_minor > 0),
  target_date TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS savings_contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor != 0),
  contribution_date TEXT NOT NULL,
  linked_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_dest_account ON transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at);
CREATE INDEX IF NOT EXISTS idx_budgets_period_category ON budgets(period_month, category_id);
CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_status_due ON recurring_occurrences(status, due_date);
CREATE INDEX IF NOT EXISTS idx_savings_contributions_goal ON savings_contributions(goal_id);
`;

/**
 * Runs all pending SQL migrations in deterministic lexicographical order
 * and seeds default settings and categories if not yet present.
 * Never wipes or recreates an existing database on failure; rolls back failed migration atomically.
 */
export function runMigrations(
  dbManager: DatabaseManager,
  options: { migrationsDir?: string; seedDefaults?: boolean } = {}
): MigrationResult {
  const defaultDir = path.join(process.cwd(), 'database', 'migrations');
  const migrationsDir = options.migrationsDir ?? defaultDir;
  const seedDefaults = options.seedDefaults ?? true;

  const db = dbManager.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ version: string }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const newlyApplied: string[] = [];

  // Guarantee 001_initial_schema is applied even if migrations directory is not found on disk
  if (!appliedSet.has('001_initial_schema')) {
    dbManager.withTransaction((txDb) => {
      txDb.exec(INITIAL_SCHEMA_SQL);
      txDb
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('001_initial_schema', new Date().toISOString());
    });
    newlyApplied.push('001_initial_schema');
    appliedSet.add('001_initial_schema');
  }

  // Also check filesystem migrations directory if present
  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const version = filename.replace(/\.sql$/, '');
      if (appliedSet.has(version)) {
        continue;
      }

      const sqlPath = path.join(migrationsDir, filename);
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

      dbManager.withTransaction((txDb) => {
        txDb.exec(sqlContent);
        txDb
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(version, new Date().toISOString());
      });

      newlyApplied.push(version);
      appliedSet.add(version);
    }
  }

  if (seedDefaults) {
    seedInitialData(dbManager);
  }

  const finalCountRow = db
    .prepare('SELECT COUNT(*) as count FROM schema_migrations')
    .get() as { count: number };

  return {
    applied: newlyApplied,
    totalApplied: Number(finalCountRow.count),
  };
}

export function seedInitialData(dbManager: DatabaseManager): void {
  const now = new Date().toISOString();

  dbManager.withTransaction((db) => {
    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value, now);
    }

    const existingCatCount = db
      .prepare('SELECT COUNT(*) as count FROM categories')
      .get() as { count: number };

    if (Number(existingCatCount.count) === 0) {
      const insertCategory = db.prepare(`
        INSERT OR IGNORE INTO categories (id, name, category_type, parent_id, display_order, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, 0, ?, ?)
      `);
      for (const cat of DEFAULT_CATEGORIES) {
        insertCategory.run(cat.id, cat.name, cat.category_type, cat.display_order, now, now);
      }
    }
  });
}
