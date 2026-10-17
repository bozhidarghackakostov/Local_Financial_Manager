import type { TransactionRepository, TransactionQueryFilters } from '../repositories/transactionRepository.ts';
import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { SettingsRepository } from '../repositories/settingsRepository.ts';
import type { PaginatedTransactions, TransactionRecord, TransactionType } from '../../shared/types/index.ts';
import { createTransactionSchema, updateTransactionSchema } from '../../shared/schemas/index.ts';
import { NotFoundError, ValidationError } from '../errors/index.ts';
import { getTodayIsoDate } from '../../shared/utils/dates.ts';

export class TransactionService {
    private readonly txRepo: TransactionRepository;
  private readonly accountRepo: AccountRepository;
  private readonly categoryRepo: CategoryRepository;
  private readonly settingsRepo: SettingsRepository;
  constructor(txRepo: TransactionRepository, accountRepo: AccountRepository, categoryRepo: CategoryRepository, settingsRepo: SettingsRepository) {
    this.txRepo = txRepo;
    this.accountRepo = accountRepo;
    this.categoryRepo = categoryRepo;
    this.settingsRepo = settingsRepo;
  }

  public listTransactions(filters: TransactionQueryFilters = {}): PaginatedTransactions {
    return this.txRepo.query(filters);
  }

  public getTransactionById(id: string): TransactionRecord {
    const tx = this.txRepo.findById(id);
    if (!tx) {
      throw new NotFoundError(`Transaction not found: ${id}`);
    }
    return tx;
  }

  public createTransaction(input: unknown): TransactionRecord {
    const parsed = createTransactionSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid transaction data', parsed.error.issues);
    }

    this.validateEntityRelationships(parsed.data);

    const settings = this.settingsRepo.getAll();
    return this.txRepo.create({
      transaction_type: parsed.data.transaction_type,
      transaction_date: parsed.data.transaction_date,
      amount_minor: parsed.data.amount_minor,
      currency: settings.base_currency,
      account_id: parsed.data.account_id,
      destination_account_id:
        parsed.data.transaction_type === 'transfer' ? parsed.data.destination_account_id : null,
      category_id: parsed.data.transaction_type === 'transfer' ? null : parsed.data.category_id,
      description: parsed.data.description,
      notes: parsed.data.notes,
      tags: parsed.data.tags,
      is_refund: parsed.data.is_refund,
      refunded_transaction_id: parsed.data.refunded_transaction_id,
    });
  }

  public updateTransaction(id: string, input: unknown): TransactionRecord {
    const existing = this.getTransactionById(id);
    const parsedPatch = updateTransactionSchema.safeParse(input);
    if (!parsedPatch.success) {
      throw new ValidationError(
        parsedPatch.error.issues[0]?.message ?? 'Invalid transaction update data',
        parsedPatch.error.issues
      );
    }

    const patch = parsedPatch.data;
    const nextType: TransactionType = patch.transaction_type ?? existing.transaction_type;

    const mergedCandidate = {
      transaction_type: nextType,
      transaction_date: patch.transaction_date ?? existing.transaction_date,
      amount_minor: patch.amount_minor ?? existing.amount_minor,
      account_id: patch.account_id ?? existing.account_id,
      destination_account_id:
        nextType === 'transfer'
          ? patch.destination_account_id !== undefined
            ? patch.destination_account_id
            : existing.destination_account_id
          : null,
      category_id:
        nextType === 'transfer'
          ? null
          : patch.category_id !== undefined
            ? patch.category_id
            : existing.category_id,
      description: patch.description ?? existing.description,
      notes: patch.notes ?? existing.notes,
      tags: patch.tags ?? existing.tags,
      is_refund:
        nextType === 'expense'
          ? patch.is_refund !== undefined
            ? patch.is_refund
            : existing.is_refund
          : false,
      refunded_transaction_id:
        patch.refunded_transaction_id !== undefined
          ? patch.refunded_transaction_id
          : existing.refunded_transaction_id,
    };

    const fullValidated = createTransactionSchema.safeParse(mergedCandidate);
    if (!fullValidated.success) {
      throw new ValidationError(
        fullValidated.error.issues[0]?.message ?? 'Invalid updated transaction state',
        fullValidated.error.issues
      );
    }

    this.validateEntityRelationships(fullValidated.data, id);

    return this.txRepo.update(id, fullValidated.data);
  }

  public deleteTransaction(id: string, permanent: boolean = false): TransactionRecord | void {
    const existing = this.getTransactionById(id);
    if (permanent) {
      this.txRepo.hardDelete(id);
      return;
    }
    if (existing.deleted_at) {
      return existing;
    }
    return this.txRepo.softDelete(id);
  }

  public restoreTransaction(id: string): TransactionRecord {
    this.getTransactionById(id);
    return this.txRepo.restore(id);
  }

  public duplicateTransaction(id: string, overrides?: { transaction_date?: string }): TransactionRecord {
    const source = this.getTransactionById(id);
    return this.createTransaction({
      transaction_type: source.transaction_type,
      transaction_date: overrides?.transaction_date ?? getTodayIsoDate(),
      amount_minor: source.amount_minor,
      account_id: source.account_id,
      destination_account_id: source.destination_account_id,
      category_id: source.category_id,
      description: source.description ? `${source.description} (Copy)` : 'Copy',
      notes: source.notes,
      tags: source.tags,
      is_refund: source.is_refund,
      refunded_transaction_id: null,
    });
  }

  private validateEntityRelationships(
    data: {
      transaction_type: TransactionType;
      account_id: string;
      destination_account_id: string | null;
      category_id: string | null;
      is_refund: boolean;
      refunded_transaction_id: string | null;
    },
    selfId?: string
  ): void {
    const sourceAccount = this.accountRepo.findById(data.account_id);
    if (!sourceAccount) {
      throw new ValidationError('Selected account does not exist');
    }

    if (data.transaction_type === 'transfer') {
      if (!data.destination_account_id) {
        throw new ValidationError('Destination account is required for transfers');
      }
      if (data.destination_account_id === data.account_id) {
        throw new ValidationError('Cannot transfer money from an account to itself');
      }
      const destAccount = this.accountRepo.findById(data.destination_account_id);
      if (!destAccount) {
        throw new ValidationError('Destination account does not exist');
      }
    } else {
      if (!data.category_id) {
        throw new ValidationError('Category is required for income and expense records');
      }
      const category = this.categoryRepo.findById(data.category_id);
      if (!category) {
        throw new ValidationError('Selected category does not exist');
      }
      if (category.category_type !== data.transaction_type) {
        throw new ValidationError(
          `Cannot use ${category.category_type} category "${category.name}" for an ${data.transaction_type} transaction`
        );
      }
    }

    if (data.refunded_transaction_id) {
      if (selfId && data.refunded_transaction_id === selfId) {
        throw new ValidationError('A transaction cannot reference itself as a refund');
      }
      const originalTx = this.txRepo.findById(data.refunded_transaction_id);
      if (!originalTx) {
        throw new ValidationError('Linked original expense transaction does not exist');
      }
      if (originalTx.transaction_type !== 'expense') {
        throw new ValidationError('Refunds can only be linked to an original expense transaction');
      }
    }
  }
}
