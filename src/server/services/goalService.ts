import type { DatabaseManager } from '../db/connection.ts';
import type { GoalRepository } from '../repositories/goalRepository.ts';
import type { AccountRepository } from '../repositories/accountRepository.ts';
import type { TransactionRepository } from '../repositories/transactionRepository.ts';
import type { GoalStatus, SavingsContribution, SavingsGoal } from '../../shared/types/index.ts';
import {
  createGoalContributionSchema,
  createGoalSchema,
  updateGoalSchema,
} from '../../shared/schemas/index.ts';
import { getTodayIsoDate } from '../../shared/utils/dates.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.ts';

export class GoalService {
    private readonly dbManager: DatabaseManager;
  private readonly goalRepo: GoalRepository;
  private readonly accountRepo: AccountRepository;
  private readonly txRepo: TransactionRepository;
  constructor(dbManager: DatabaseManager, goalRepo: GoalRepository, accountRepo: AccountRepository, txRepo: TransactionRepository) {
    this.dbManager = dbManager;
    this.goalRepo = goalRepo;
    this.accountRepo = accountRepo;
    this.txRepo = txRepo;
  }

  public listGoals(options: { status?: GoalStatus } = {}): SavingsGoal[] {
    return this.goalRepo.findAll(options);
  }

  public getGoalById(id: string): SavingsGoal & { contributions: SavingsContribution[] } {
    const goal = this.goalRepo.findById(id);
    if (!goal) {
      throw new NotFoundError(`Savings goal not found: ${id}`);
    }
    const contributions = this.goalRepo.listContributions(id);
    return { ...goal, contributions };
  }

  public createGoal(input: unknown): SavingsGoal {
    const parsed = createGoalSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid savings goal data', parsed.error.issues);
    }

    const existing = this.goalRepo.findByName(parsed.data.name);
    if (existing) {
      throw new ConflictError(`A savings goal named "${parsed.data.name}" already exists`);
    }

    if (parsed.data.account_id) {
      const account = this.accountRepo.findById(parsed.data.account_id);
      if (!account) {
        throw new ValidationError('Selected reference account does not exist');
      }
    }

    return this.dbManager.withTransaction(() => {
      const created = this.goalRepo.create({
        name: parsed.data.name,
        target_amount_minor: parsed.data.target_amount_minor,
        target_date: parsed.data.target_date ?? null,
        account_id: parsed.data.account_id ?? null,
        description: parsed.data.description,
      });

      if (parsed.data.initial_contribution_minor && parsed.data.initial_contribution_minor > 0) {
        this.goalRepo.addContribution({
          goal_id: created.id,
          amount_minor: parsed.data.initial_contribution_minor,
          contribution_date: getTodayIsoDate(),
          linked_transaction_id: null,
          notes: 'Initial contribution',
        });
      }

      return this.goalRepo.findById(created.id)!;
    });
  }

  public updateGoal(id: string, input: unknown): SavingsGoal {
    const current = this.goalRepo.findById(id);
    if (!current) {
      throw new NotFoundError(`Savings goal not found: ${id}`);
    }

    const parsed = updateGoalSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid savings goal update data',
        parsed.error.issues
      );
    }

    if (parsed.data.name && parsed.data.name.toLowerCase() !== current.name.toLowerCase()) {
      const dup = this.goalRepo.findByName(parsed.data.name);
      if (dup && dup.id !== id) {
        throw new ConflictError(`A savings goal named "${parsed.data.name}" already exists`);
      }
    }

    if (parsed.data.account_id) {
      const account = this.accountRepo.findById(parsed.data.account_id);
      if (!account) {
        throw new ValidationError('Selected reference account does not exist');
      }
    }

    return this.goalRepo.update(id, parsed.data);
  }

  public addContribution(
    goalId: string,
    input: unknown
  ): { goal: SavingsGoal; contribution: SavingsContribution } {
    const goal = this.goalRepo.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Savings goal not found: ${goalId}`);
    }

    const parsed = createGoalContributionSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid contribution data', parsed.error.issues);
    }

    if (parsed.data.linked_transaction_id) {
      const tx = this.txRepo.findById(parsed.data.linked_transaction_id);
      if (!tx) {
        throw new ValidationError('Linked transaction does not exist');
      }
    }

    return this.dbManager.withTransaction(() => {
      const contribution = this.goalRepo.addContribution({
        goal_id: goalId,
        amount_minor: parsed.data.amount_minor,
        contribution_date: parsed.data.contribution_date,
        linked_transaction_id: parsed.data.linked_transaction_id ?? null,
        notes: parsed.data.notes,
      });

      let updatedGoal = this.goalRepo.findById(goalId)!;
      if (
        updatedGoal.status === 'active' &&
        updatedGoal.current_amount_minor >= updatedGoal.target_amount_minor
      ) {
        updatedGoal = this.goalRepo.update(goalId, { status: 'completed' });
      }

      return { goal: updatedGoal, contribution };
    });
  }

  public deleteContribution(goalId: string, contributionId: string): SavingsGoal {
    const goal = this.goalRepo.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Savings goal not found: ${goalId}`);
    }
    this.goalRepo.deleteContribution(contributionId);
    return this.goalRepo.findById(goalId)!;
  }

  public deleteGoal(id: string): void {
    const goal = this.goalRepo.findById(id);
    if (!goal) {
      throw new NotFoundError(`Savings goal not found: ${id}`);
    }
    this.goalRepo.delete(id);
  }
}
