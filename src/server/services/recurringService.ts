import type { DatabaseManager } from '../db/connection.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { TransactionService } from './transactionService.ts';
import type {
  OccurrenceStatus,
  RecurringOccurrence,
  RecurringRule,
  RecurringStatus,
  TransactionRecord,
} from '../../shared/types/index.ts';
import {
  confirmOccurrenceSchema,
  createRecurringRuleSchema,
  updateRecurringRuleSchema,
} from '../../shared/schemas/index.ts';
import { addCalendarDays, advanceRecurringDate, getTodayIsoDate } from '../../shared/utils/dates.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.ts';

export class RecurringService {
    private readonly dbManager: DatabaseManager;
  private readonly recurringRepo: RecurringRepository;
  private readonly accountRepo: AccountRepository;
  private readonly categoryRepo: CategoryRepository;
  private readonly transactionService: TransactionService;
  constructor(dbManager: DatabaseManager, recurringRepo: RecurringRepository, accountRepo: AccountRepository, categoryRepo: CategoryRepository, transactionService: TransactionService) {
    this.dbManager = dbManager;
    this.recurringRepo = recurringRepo;
    this.accountRepo = accountRepo;
    this.categoryRepo = categoryRepo;
    this.transactionService = transactionService;
  }

  public listRules(options: { status?: RecurringStatus; referenceDate?: string } = {}): RecurringRule[] {
    this.materializeOccurrences(options.referenceDate);
    return this.recurringRepo.findAllRules({ status: options.status });
  }

  public getRuleById(id: string): RecurringRule {
    const rule = this.recurringRepo.findRuleById(id);
    if (!rule) {
      throw new NotFoundError(`Recurring rule not found: ${id}`);
    }
    return rule;
  }

  public createRule(input: unknown, referenceDate: string = getTodayIsoDate()): RecurringRule {
    const parsed = createRecurringRuleSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid recurring rule data', parsed.error.issues);
    }

    const account = this.accountRepo.findById(parsed.data.account_id);
    if (!account) {
      throw new ValidationError('Selected account does not exist');
    }

    const category = this.categoryRepo.findById(parsed.data.category_id);
    if (!category) {
      throw new ValidationError('Selected category does not exist');
    }
    if (category.category_type !== parsed.data.transaction_type) {
      throw new ValidationError(
        `Category "${category.name}" is of type ${category.category_type}, expected ${parsed.data.transaction_type}`
      );
    }

    const rule = this.recurringRepo.createRule({
      name: parsed.data.name,
      transaction_type: parsed.data.transaction_type,
      amount_minor: parsed.data.amount_minor,
      account_id: parsed.data.account_id,
      category_id: parsed.data.category_id,
      description: parsed.data.description,
      frequency: parsed.data.frequency,
      interval_count: parsed.data.interval_count,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      next_due_date: parsed.data.start_date,
    });

    this.materializeOccurrencesForRule(rule, addCalendarDays(referenceDate, 35));
    return this.getRuleById(rule.id);
  }

  public updateRule(id: string, input: unknown, referenceDate: string = getTodayIsoDate()): RecurringRule {
    const current = this.getRuleById(id);
    const parsed = updateRecurringRuleSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid recurring rule update data',
        parsed.error.issues
      );
    }

    if (parsed.data.account_id) {
      const account = this.accountRepo.findById(parsed.data.account_id);
      if (!account) {
        throw new ValidationError('Selected account does not exist');
      }
    }

    if (parsed.data.category_id) {
      const category = this.categoryRepo.findById(parsed.data.category_id);
      if (!category || category.category_type !== current.transaction_type) {
        throw new ValidationError('Selected category is invalid for this recurring rule');
      }
    }

    if (parsed.data.end_date && parsed.data.end_date < current.start_date) {
      throw new ValidationError('End date cannot be earlier than start date');
    }

    const updated = this.recurringRepo.updateRule(id, parsed.data);
    if (updated.status === 'active') {
      this.materializeOccurrencesForRule(updated, addCalendarDays(referenceDate, 35));
    }
    return this.getRuleById(id);
  }

  /**
   * Idempotently generates occurrences for all active rules up to horizonDate (default: referenceDate + 35 days).
   * Safe to invoke on every dashboard or recurring page load without ever duplicating records.
   */
  public materializeOccurrences(referenceDate: string = getTodayIsoDate(), horizonDays: number = 35): void {
    const horizonDate = addCalendarDays(referenceDate, horizonDays);
    const activeRules = this.recurringRepo.findAllRules({ status: 'active' });

    this.dbManager.withTransaction(() => {
      for (const rule of activeRules) {
        this.materializeOccurrencesForRule(rule, horizonDate);
      }
    });
  }

  private materializeOccurrencesForRule(rule: RecurringRule, horizonDate: string): void {
    if (rule.status !== 'active') return;

    const maxDate = rule.end_date && rule.end_date < horizonDate ? rule.end_date : horizonDate;
    let cursorDate = rule.start_date;
    let safetyCounter = 0;

    while (cursorDate <= maxDate && safetyCounter < 1000) {
      this.recurringRepo.insertOccurrenceIgnoreDuplicate({
        recurring_rule_id: rule.id,
        due_date: cursorDate,
        expected_amount_minor: rule.amount_minor,
      });
      cursorDate = advanceRecurringDate(cursorDate, rule.frequency, rule.interval_count);
      safetyCounter += 1;
    }

    // Also ensure at least one pending occurrence exists if rule has not passed end_date
    const pendingList = this.recurringRepo.findOccurrences({
      ruleId: rule.id,
      status: 'pending',
    });

    let nextDue = cursorDate;
    if (pendingList.length > 0) {
      nextDue = pendingList[0].due_date;
    } else if (!rule.end_date || cursorDate <= rule.end_date) {
      this.recurringRepo.insertOccurrenceIgnoreDuplicate({
        recurring_rule_id: rule.id,
        due_date: cursorDate,
        expected_amount_minor: rule.amount_minor,
      });
      nextDue = cursorDate;
    }

    if (nextDue !== rule.next_due_date) {
      this.recurringRepo.updateRule(rule.id, { next_due_date: nextDue });
    }
  }

  public listOccurrences(
    options: {
      ruleId?: string;
      status?: OccurrenceStatus;
      maxDueDate?: string;
      referenceDate?: string;
    } = {}
  ): RecurringOccurrence[] {
    const refDate = options.referenceDate ?? getTodayIsoDate();
    this.materializeOccurrences(refDate);
    return this.recurringRepo.findOccurrences({
      ...options,
      referenceDate: refDate,
    });
  }

  /**
   * Atomically confirms a pending occurrence and posts the corresponding transaction to the ledger.
   * Rejects duplicate confirmation attempts with ConflictError (409).
   */
  public confirmOccurrence(
    occurrenceId: string,
    input: unknown = {},
    referenceDate: string = getTodayIsoDate()
  ): { occurrence: RecurringOccurrence; transaction: TransactionRecord } {
    const occurrence = this.recurringRepo.findOccurrenceById(occurrenceId, referenceDate);
    if (!occurrence) {
      throw new NotFoundError(`Recurring occurrence not found: ${occurrenceId}`);
    }
    if (occurrence.status === 'confirmed') {
      throw new ConflictError('This recurring payment occurrence has already been confirmed and posted to the ledger');
    }
    if (occurrence.status === 'skipped') {
      throw new ConflictError('Cannot confirm a skipped occurrence');
    }

    const parsed = confirmOccurrenceSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid confirmation parameters');
    }

    const rule = this.getRuleById(occurrence.recurring_rule_id);

    return this.dbManager.withTransaction(() => {
      const tx = this.transactionService.createTransaction({
        transaction_type: rule.transaction_type,
        transaction_date: parsed.data.transaction_date ?? occurrence.due_date,
        amount_minor: parsed.data.amount_minor ?? occurrence.expected_amount_minor,
        account_id: rule.account_id,
        category_id: rule.category_id,
        description: rule.description || rule.name,
        notes: parsed.data.notes ?? `Recurring payment: ${rule.name} (due ${occurrence.due_date})`,
        tags: ['recurring'],
      });

      const updatedOccurrence = this.recurringRepo.updateOccurrenceStatus(occurrenceId, 'confirmed', tx.id);
      this.materializeOccurrencesForRule(rule, addCalendarDays(referenceDate, 35));

      return {
        occurrence: updatedOccurrence,
        transaction: tx,
      };
    });
  }

  public skipOccurrence(occurrenceId: string, referenceDate: string = getTodayIsoDate()): RecurringOccurrence {
    const occurrence = this.recurringRepo.findOccurrenceById(occurrenceId, referenceDate);
    if (!occurrence) {
      throw new NotFoundError(`Recurring occurrence not found: ${occurrenceId}`);
    }
    if (occurrence.status !== 'pending') {
      throw new ConflictError(`Only pending occurrences can be skipped (current status: ${occurrence.status})`);
    }

    const updated = this.recurringRepo.updateOccurrenceStatus(occurrenceId, 'skipped', null);
    const rule = this.getRuleById(occurrence.recurring_rule_id);
    this.materializeOccurrencesForRule(rule, addCalendarDays(referenceDate, 35));
    return updated;
  }
}
