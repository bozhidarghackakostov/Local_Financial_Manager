import crypto from 'node:crypto';
import type { DatabaseManager } from '../db/connection.ts';
import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { TransactionRepository, TransactionQueryFilters } from '../repositories/transactionRepository.ts';
import type { SettingsRepository } from '../repositories/settingsRepository.ts';
import type {
  CsvPreviewResult,
  CsvPreviewRow,
  TransactionRecord,
} from '../../shared/types/index.ts';
import { csvCommitRequestSchema, csvPreviewRequestSchema } from '../../shared/schemas/index.ts';
import { minorUnitsToDecimalString, parseDecimalToMinorUnits } from '../../shared/utils/money.ts';
import { parseExternalDateToIso } from '../../shared/utils/dates.ts';
import { ValidationError } from '../errors/index.ts';

/**
 * RFC-4180 compliant CSV parser supporting quoted fields, escaped quotes, and custom delimiters.
 */
export function parseCsvString(content: string, delimiter: string = ','): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { headers: [], rows: [] };
  }

  const parsedLines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) {
          parsedLines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell !== '')) {
    parsedLines.push(currentRow);
  }

  if (parsedLines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parsedLines[0].map((h, idx) => h || `Column_${idx + 1}`);
  const rows: Array<Record<string, string>> = [];

  for (let r = 1; r < parsedLines.length; r++) {
    const line = parsedLines[r];
    const obj: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      obj[h] = line[colIdx] ?? '';
    });
    rows.push(obj);
  }

  return { headers, rows };
}

export class ImportExportService {
    private readonly dbManager: DatabaseManager;
  private readonly accountRepo: AccountRepository;
  private readonly categoryRepo: CategoryRepository;
  private readonly txRepo: TransactionRepository;
  private readonly settingsRepo: SettingsRepository;
  constructor(dbManager: DatabaseManager, accountRepo: AccountRepository, categoryRepo: CategoryRepository, txRepo: TransactionRepository, settingsRepo: SettingsRepository) {
    this.dbManager = dbManager;
    this.accountRepo = accountRepo;
    this.categoryRepo = categoryRepo;
    this.txRepo = txRepo;
    this.settingsRepo = settingsRepo;
  }

  public inspectCsvHeaders(csvContent: string, delimiter: ',' | ';' | '\t' = ','): {
    headers: string[];
    sampleRows: Array<Record<string, string>>;
    totalRows: number;
  } {
    if (!csvContent || !csvContent.trim()) {
      throw new ValidationError('CSV content cannot be empty');
    }
    const { headers, rows } = parseCsvString(csvContent, delimiter);
    if (headers.length === 0) {
      throw new ValidationError('Could not detect any CSV headers');
    }
    return {
      headers,
      sampleRows: rows.slice(0, 5),
      totalRows: rows.length,
    };
  }

  public previewCsvImport(input: unknown): CsvPreviewResult {
    const parsed = csvPreviewRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid CSV preview request', parsed.error.issues);
    }

    const { csvContent, accountId, delimiter, mapping } = parsed.data;
    const account = this.accountRepo.findById(accountId);
    if (!account) {
      throw new ValidationError('Target account does not exist');
    }

    const { headers, rows } = parseCsvString(csvContent, delimiter);
    const categories = this.categoryRepo.findAll({ includeArchived: true });
    const defaultExpenseCat =
      categories.find((c) => c.id === mapping.defaultCategoryId && c.category_type === 'expense') ??
      categories.find((c) => c.category_type === 'expense' && c.name.toLowerCase().includes('other')) ??
      categories.find((c) => c.category_type === 'expense')!;
    const defaultIncomeCat =
      categories.find((c) => c.id === mapping.defaultCategoryId && c.category_type === 'income') ??
      categories.find((c) => c.category_type === 'income' && c.name.toLowerCase().includes('other')) ??
      categories.find((c) => c.category_type === 'income')!;

    // Load existing transactions on this account for duplicate detection
    const existingTxs = this.txRepo.findAllMatching({
      accountId,
      status: 'active',
    });

    const previewRows: CsvPreviewRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    rows.forEach((raw, idx) => {
      const errors: string[] = [];
      const rawDate = raw[mapping.dateColumn] ?? '';
      const rawAmount = raw[mapping.amountColumn] ?? '';
      const rawDesc = raw[mapping.descriptionColumn] ?? '';
      const rawType = mapping.typeColumn ? raw[mapping.typeColumn] ?? '' : '';
      const rawCategory = mapping.categoryColumn ? raw[mapping.categoryColumn] ?? '' : '';
      const rawNotes = mapping.notesColumn ? raw[mapping.notesColumn] ?? '' : '';
      const rawExtId = mapping.externalIdColumn ? raw[mapping.externalIdColumn] ?? '' : '';

      let isoDate = '';
      try {
        isoDate = parseExternalDateToIso(rawDate, mapping.dateFormat);
      } catch (e) {
        errors.push((e as Error).message);
      }

      let signedAmountMinor = 0;
      try {
        signedAmountMinor = parseDecimalToMinorUnits(rawAmount, {
          allowNegative: true,
          allowZero: false,
          decimalSeparator: mapping.decimalSeparator,
        });
      } catch (e) {
        errors.push((e as Error).message);
      }

      // Determine transaction type:
      // 1) If typeColumn is mapped and specifies income/credit vs expense/debit
      // 2) Else if signedAmountMinor < 0 -> expense, > 0 -> check if typeColumn says expense, otherwise default positive to expense unless signed negative is present
      let txType: 'income' | 'expense' = 'expense';
      const normalizedType = rawType.trim().toLowerCase();
      if (normalizedType) {
        if (['income', 'credit', 'inflow', 'deposit', 'cr'].includes(normalizedType)) {
          txType = 'income';
        } else if (['expense', 'debit', 'outflow', 'payment', 'dr'].includes(normalizedType)) {
          txType = 'expense';
        } else {
          errors.push(`Unrecognized transaction type "${rawType}"`);
        }
      } else {
        txType = signedAmountMinor < 0 ? 'expense' : 'income';
      }

      const absAmountMinor = Math.abs(signedAmountMinor);
      if (absAmountMinor <= 0 && errors.length === 0) {
        errors.push('Amount must be greater than zero');
      }

      // Resolve category
      let matchedCategory = rawCategory
        ? categories.find(
            (c) =>
              c.category_type === txType &&
              c.name.toLowerCase() === rawCategory.trim().toLowerCase()
          )
        : undefined;

      if (!matchedCategory) {
        matchedCategory = txType === 'income' ? defaultIncomeCat : defaultExpenseCat;
      }

      // Duplicate detection against existing ledger transactions
      let isProbableDuplicate = false;
      let duplicateReason: string | undefined;

      if (errors.length === 0) {
        const externalIdTrimmed = rawExtId.trim() || null;
        if (externalIdTrimmed) {
          const extMatch = existingTxs.find((t) => t.import_external_id === externalIdTrimmed);
          if (extMatch) {
            isProbableDuplicate = true;
            duplicateReason = `Matches existing imported transaction ID "${externalIdTrimmed}"`;
          }
        }

        if (!isProbableDuplicate) {
          const sameTuple = existingTxs.find(
            (t) =>
              t.transaction_date === isoDate &&
              t.amount_minor === absAmountMinor &&
              t.transaction_type === txType &&
              t.description.trim().toLowerCase() === rawDesc.trim().toLowerCase()
          );
          if (sameTuple) {
            isProbableDuplicate = true;
            duplicateReason = `Matches existing ${txType} on ${isoDate} for ${minorUnitsToDecimalString(absAmountMinor)} ("${sameTuple.description}")`;
          }
        }
      }

      const valid = errors.length === 0;
      if (valid) {
        validCount += 1;
        if (isProbableDuplicate) {
          duplicateCount += 1;
        }
      } else {
        invalidCount += 1;
      }

      previewRows.push({
        rowIndex: idx + 1,
        raw,
        valid,
        errors,
        isProbableDuplicate,
        duplicateReason,
        parsed: valid
          ? {
              transaction_date: isoDate,
              transaction_type: txType,
              amount_minor: absAmountMinor,
              description: rawDesc.trim() || matchedCategory.name,
              notes: rawNotes.trim(),
              category_id: matchedCategory.id,
              category_name: matchedCategory.name,
              import_external_id: rawExtId.trim() || null,
            }
          : undefined,
      });
    });

    return {
      headers,
      totalRows: rows.length,
      validCount,
      invalidCount,
      duplicateCount,
      rows: previewRows,
    };
  }

  public commitCsvImport(input: unknown): {
    batchId: string;
    importedCount: number;
    skippedCount: number;
    errorCount: number;
  } {
    const parsed = csvCommitRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid CSV commit payload', parsed.error.issues);
    }

    const { sourceFilename, accountId, includeDuplicates, rows } = parsed.data;
    const account = this.accountRepo.findById(accountId);
    if (!account) {
      throw new ValidationError('Target account does not exist');
    }

    const settings = this.settingsRepo.getAll();
    const batchId = `imp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    let importedCount = 0;
    let skippedCount = 0;

    this.dbManager.withTransaction((db) => {
      db.prepare(
        `INSERT INTO import_batches (id, source_filename, import_date, account_id, status, imported_count, skipped_count, error_count)
         VALUES (?, ?, ?, ?, 'completed', 0, 0, 0)`
      ).run(batchId, sourceFilename, now, accountId);

      for (const row of rows) {
        if (row.skip || (row.isProbableDuplicate && !includeDuplicates)) {
          skippedCount += 1;
          continue;
        }

        const category = this.categoryRepo.findById(row.category_id);
        if (!category || category.category_type !== row.transaction_type) {
          throw new ValidationError(`Invalid category for row ${row.rowIndex}`);
        }

        this.txRepo.create({
          transaction_type: row.transaction_type,
          transaction_date: row.transaction_date,
          amount_minor: row.amount_minor,
          currency: settings.base_currency,
          account_id: accountId,
          destination_account_id: null,
          category_id: row.category_id,
          description: row.description,
          notes: row.notes,
          tags: ['csv-import'],
          is_refund: false,
          refunded_transaction_id: null,
          import_batch_id: batchId,
          import_external_id: row.import_external_id ?? null,
        });
        importedCount += 1;
      }

      db.prepare(
        `UPDATE import_batches SET imported_count = ?, skipped_count = ? WHERE id = ?`
      ).run(importedCount, skippedCount, batchId);
    });

    return {
      batchId,
      importedCount,
      skippedCount,
      errorCount: 0,
    };
  }

  public exportTransactionsCsv(filters: TransactionQueryFilters = {}): string {
    const txs = this.txRepo.findAllMatching({
      ...filters,
      status: filters.status ?? 'active',
    });

    const escapeCsv = (val: string | number | null | undefined): string => {
      const str = val === null || val === undefined ? '' : String(val);
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = [
      'ID',
      'Date',
      'Type',
      'Amount',
      'Currency',
      'Account',
      'Destination Account',
      'Category',
      'Description',
      'Notes',
      'Tags',
      'Is Refund',
      'Created At',
    ];

    const rows = txs.map((t: TransactionRecord) => [
      t.id,
      t.transaction_date,
      t.transaction_type,
      minorUnitsToDecimalString(t.amount_minor),
      t.currency,
      t.account_name ?? t.account_id,
      t.destination_account_name ?? '',
      t.category_name ?? '',
      t.description,
      t.notes,
      t.tags.join(';'),
      t.is_refund ? 'true' : 'false',
      t.created_at,
    ]);

    return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
  }

  public exportFullJson(): Record<string, unknown> {
    const db = this.dbManager.db;
    return {
      schema_version: '1.0.0',
      exported_at: new Date().toISOString(),
      application: 'LedgerDesk',
      data: {
        app_settings: db.prepare('SELECT * FROM app_settings ORDER BY setting_key ASC').all(),
        accounts: db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all(),
        categories: db.prepare('SELECT * FROM categories ORDER BY display_order ASC, name ASC').all(),
        transactions: db.prepare('SELECT * FROM transactions ORDER BY transaction_date ASC, created_at ASC').all(),
        tags: db.prepare('SELECT * FROM tags ORDER BY name ASC').all(),
        transaction_tags: db.prepare('SELECT * FROM transaction_tags').all(),
        budgets: db.prepare('SELECT * FROM budgets ORDER BY period_month DESC').all(),
        recurring_rules: db.prepare('SELECT * FROM recurring_rules ORDER BY created_at ASC').all(),
        recurring_occurrences: db.prepare('SELECT * FROM recurring_occurrences ORDER BY due_date ASC').all(),
        savings_goals: db.prepare('SELECT * FROM savings_goals ORDER BY created_at ASC').all(),
        savings_contributions: db.prepare('SELECT * FROM savings_contributions ORDER BY contribution_date ASC').all(),
        import_batches: db.prepare('SELECT * FROM import_batches ORDER BY import_date DESC').all(),
      },
    };
  }
}
