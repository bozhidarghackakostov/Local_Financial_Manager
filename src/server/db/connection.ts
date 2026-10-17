import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class DatabaseManager {
  private instance: DatabaseSync;
  public readonly dbPath: string;
  public readonly backupsDir: string;
  private transactionDepth = 0;

  constructor(dbPath?: string, backupsDir?: string) {
    const rootDir = process.cwd();
    this.dbPath = dbPath ?? process.env.LEDGERDESK_DB_PATH ?? path.join(rootDir, 'data', 'ledgerdesk.sqlite');
    this.backupsDir =
      backupsDir ??
      process.env.LEDGERDESK_BACKUPS_DIR ??
      (this.dbPath === ':memory:'
        ? path.join(rootDir, 'data', 'backups')
        : path.join(path.dirname(this.dbPath), 'backups'));

    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    fs.mkdirSync(this.backupsDir, { recursive: true });

    this.instance = this.openDatabase(this.dbPath);
  }

  private openDatabase(targetPath: string): DatabaseSync {
    const db = new DatabaseSync(targetPath, {
      enableForeignKeyConstraints: true,
    });
    if (targetPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
    }
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    return db;
  }

  public get db(): DatabaseSync {
    return this.instance;
  }

  public close(): void {
    if (this.instance.isOpen) {
      this.instance.close();
    }
  }

  public reopen(): void {
    this.close();
    this.transactionDepth = 0;
    this.instance = this.openDatabase(this.dbPath);
  }

  /**
   * Executes a synchronous callback inside an atomic SQLite transaction (or savepoint if nested).
   */
  public withTransaction<T>(fn: (db: DatabaseSync) => T): T {
    const depth = this.transactionDepth;
    const savepointName = `sp_${depth}`;
    this.transactionDepth += 1;

    try {
      if (depth === 0) {
        this.instance.exec('BEGIN IMMEDIATE;');
      } else {
        this.instance.exec(`SAVEPOINT ${savepointName};`);
      }

      const result = fn(this.instance);

      if (depth === 0) {
        this.instance.exec('COMMIT;');
      } else {
        this.instance.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
      return result;
    } catch (err) {
      try {
        if (depth === 0) {
          this.instance.exec('ROLLBACK;');
        } else {
          this.instance.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
          this.instance.exec(`RELEASE SAVEPOINT ${savepointName};`);
        }
      } catch {
        // Ignore rollback error if transaction was already rolled back by SQLite
      }
      throw err;
    } finally {
      this.transactionDepth -= 1;
    }
  }
}
