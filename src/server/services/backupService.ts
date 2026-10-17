import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import type { DatabaseManager } from '../db/connection.ts';
import type { BackupMetadata } from '../../shared/types/index.ts';
import { NotFoundError, ValidationError } from '../errors/index.ts';

const SAFE_BACKUP_FILENAME_REGEX = /^[a-zA-Z0-9._-]+\.sqlite$/;

const REQUIRED_TABLES = [
  'schema_migrations',
  'app_settings',
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'recurring_rules',
  'recurring_occurrences',
  'savings_goals',
  'savings_contributions',
];

export class BackupService {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public listBackups(): BackupMetadata[] {
    const dir = this.dbManager.backupsDir;
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => SAFE_BACKUP_FILENAME_REGEX.test(f) && !f.startsWith('tmp_'));

    const items: BackupMetadata[] = files.map((filename) => {
      const fullPath = path.join(dir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    });

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async createBackup(customLabel?: string): Promise<BackupMetadata> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cleanLabel = customLabel
      ? customLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
      : 'manual';
    const filename = `ledgerdesk-${cleanLabel}-${timestamp}.sqlite`;
    const destPath = this.resolveSafeBackupPath(filename);

    // Use node:sqlite native online backup API
    await sqliteBackup(this.dbManager.db, destPath);

    // Validate the resulting backup immediately
    this.validateBackupFile(destPath);

    const stat = fs.statSync(destPath);
    return {
      filename,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  }

  public getBackupFilePath(filename: string): string {
    const fullPath = this.resolveSafeBackupPath(filename);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError(`Backup file not found: ${filename}`);
    }
    return fullPath;
  }

  /**
   * Validates that a candidate SQLite file is a genuine, uncorrupted LedgerDesk database
   * containing all required schema tables and passing PRAGMA integrity_check.
   */
  public validateBackupFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('Backup file does not exist');
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 4096) {
      throw new ValidationError('Invalid backup file: file is too small to be a valid SQLite database');
    }

    // Check SQLite 16-byte header magic ("SQLite format 3\0")
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(16);
    try {
      fs.readSync(fd, headerBuf, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    const magic = headerBuf.toString('utf8', 0, 15);
    if (magic !== 'SQLite format 3') {
      throw new ValidationError('Invalid backup file: not a valid SQLite 3 database');
    }

    let testDb: DatabaseSync | null = null;
    try {
      testDb = new DatabaseSync(filePath, { readOnly: true });
      const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (integrity.integrity_check !== 'ok') {
        throw new ValidationError(`Backup database failed integrity check: ${integrity.integrity_check}`);
      }

      const tables = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));

      for (const reqTable of REQUIRED_TABLES) {
        if (!tableNames.has(reqTable)) {
          throw new ValidationError(
            `Backup database is missing required LedgerDesk table: "${reqTable}"`
          );
        }
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        throw err;
      }
      throw new ValidationError(`Corrupted or unreadable SQLite backup file: ${(err as Error).message}`);
    } finally {
      if (testDb && testDb.isOpen) {
        testDb.close();
      }
    }
  }

  /**
   * Atomically restores the active database from a validated backup file in backupsDir.
   * Creates a pre-restore safety backup before replacing the live database, and rolls back if anything fails.
   */
  public async restoreFromBackupFilename(filename: string): Promise<{
    restoredFrom: string;
    safetyBackupFilename: string;
  }> {
    const sourceBackupPath = this.getBackupFilePath(filename);
    this.validateBackupFile(sourceBackupPath);

    // Create a safety backup of the current live database first
    const safetyBackup = await this.createBackup('pre-restore-safety');

    if (this.dbManager.dbPath === ':memory:') {
      throw new ValidationError('Cannot perform file-based restore on an in-memory database without file path');
    }

    const activeDbPath = this.dbManager.dbPath;
    const walPath = `${activeDbPath}-wal`;
    const shmPath = `${activeDbPath}-shm`;
    const tempSwapPath = `${activeDbPath}.restore_tmp`;

    fs.copyFileSync(sourceBackupPath, tempSwapPath);
    this.validateBackupFile(tempSwapPath);

    try {
      this.dbManager.close();
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      fs.renameSync(tempSwapPath, activeDbPath);
      this.dbManager.reopen();
    } catch (err) {
      // Attempt to recover using safety backup if swap failed
      const safetyPath = this.resolveSafeBackupPath(safetyBackup.filename);
      if (fs.existsSync(safetyPath)) {
        fs.copyFileSync(safetyPath, activeDbPath);
      }
      this.dbManager.reopen();
      throw new ValidationError(`Failed to restore database: ${(err as Error).message}`);
    } finally {
      if (fs.existsSync(tempSwapPath)) {
        fs.unlinkSync(tempSwapPath);
      }
    }

    return {
      restoredFrom: filename,
      safetyBackupFilename: safetyBackup.filename,
    };
  }

  /**
   * Accepts a base64-encoded SQLite file upload, writes to a temporary file, validates it,
   * saves it into backupsDir, and restores it.
   */
  public async restoreFromUploadedBase64(
    base64Data: string,
    originalFilename: string = 'uploaded.sqlite'
  ): Promise<{ restoredFrom: string; safetyBackupFilename: string }> {
    const cleanBase = path
      .basename(originalFilename)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.sqlite$/i, '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const savedFilename = `uploaded-${cleanBase}-${timestamp}.sqlite`;
    const targetPath = this.resolveSafeBackupPath(savedFilename);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(targetPath, buffer);

    try {
      this.validateBackupFile(targetPath);
    } catch (err) {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      throw err;
    }

    return this.restoreFromBackupFilename(savedFilename);
  }

  private resolveSafeBackupPath(filename: string): string {
    const base = path.basename(filename);
    if (!SAFE_BACKUP_FILENAME_REGEX.test(base) || base !== filename) {
      throw new ValidationError(`Invalid backup filename: "${filename}"`);
    }
    const resolved = path.resolve(this.dbManager.backupsDir, base);
    const backupsRoot = path.resolve(this.dbManager.backupsDir);
    if (!resolved.startsWith(backupsRoot + path.sep)) {
      throw new ValidationError('Backup path traversal blocked');
    }
    return resolved;
  }
}
