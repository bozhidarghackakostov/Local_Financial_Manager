import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { SettingsRepository } from '../repositories/settingsRepository.ts';
import type { Account } from '../../shared/types/index.ts';
import { createAccountSchema, updateAccountSchema } from '../../shared/schemas/index.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.ts';

export class AccountService {
    private readonly accountRepo: AccountRepository;
  private readonly settingsRepo: SettingsRepository;
  constructor(accountRepo: AccountRepository, settingsRepo: SettingsRepository) {
    this.accountRepo = accountRepo;
    this.settingsRepo = settingsRepo;
  }

  public listAccounts(options: { includeArchived?: boolean } = {}): Account[] {
    return this.accountRepo.findAll(options);
  }

  public getAccountById(id: string): Account {
    const account = this.accountRepo.findById(id);
    if (!account) {
      throw new NotFoundError(`Account not found: ${id}`);
    }
    return account;
  }

  public createAccount(input: unknown): Account {
    const parsed = createAccountSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid account data', parsed.error.issues);
    }

    const existing = this.accountRepo.findByName(parsed.data.name);
    if (existing) {
      throw new ConflictError(`An account named "${parsed.data.name}" already exists`);
    }

    const settings = this.settingsRepo.getAll();
    return this.accountRepo.create({
      name: parsed.data.name,
      account_type: parsed.data.account_type,
      opening_balance_minor: parsed.data.opening_balance_minor,
      currency: settings.base_currency,
      description: parsed.data.description,
    });
  }

  public updateAccount(id: string, input: unknown): Account {
    const current = this.getAccountById(id);
    const parsed = updateAccountSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid account update data', parsed.error.issues);
    }

    if (parsed.data.name && parsed.data.name.toLowerCase() !== current.name.toLowerCase()) {
      const duplicate = this.accountRepo.findByName(parsed.data.name);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError(`An account named "${parsed.data.name}" already exists`);
      }
    }

    return this.accountRepo.update(id, parsed.data);
  }

  public archiveAccount(id: string, archived: boolean = true): Account {
    this.getAccountById(id);
    return this.accountRepo.update(id, { status: archived ? 'archived' : 'active' });
  }

  public deleteAccount(id: string): void {
    this.getAccountById(id);
    const refCount = this.accountRepo.countReferences(id);
    if (refCount > 0) {
      throw new ConflictError(
        `Cannot delete account because it is referenced by ${refCount} financial record(s). Archive the account instead to preserve historical integrity.`
      );
    }
    this.accountRepo.delete(id);
  }
}
