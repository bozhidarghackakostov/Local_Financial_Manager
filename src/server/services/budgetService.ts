import type { BudgetRepository } from '../repositories/budgetRepository.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { BudgetWithActuals } from '../../shared/types/index.ts';
import { createBudgetSchema, updateBudgetSchema } from '../../shared/schemas/index.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.ts';

export class BudgetService {
    private readonly budgetRepo: BudgetRepository;
  private readonly categoryRepo: CategoryRepository;
  constructor(budgetRepo: BudgetRepository, categoryRepo: CategoryRepository) {
    this.budgetRepo = budgetRepo;
    this.categoryRepo = categoryRepo;
  }

  public listBudgets(options: { periodMonth?: string; includeArchived?: boolean } = {}): BudgetWithActuals[] {
    return this.budgetRepo.findAll(options);
  }

  public getBudgetById(id: string): BudgetWithActuals {
    const budget = this.budgetRepo.findById(id);
    if (!budget) {
      throw new NotFoundError(`Budget not found: ${id}`);
    }
    return budget;
  }

  public createBudget(input: unknown): BudgetWithActuals {
    const parsed = createBudgetSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid budget data', parsed.error.issues);
    }

    if (parsed.data.category_id) {
      const category = this.categoryRepo.findById(parsed.data.category_id);
      if (!category) {
        throw new ValidationError('Selected category does not exist');
      }
      if (category.category_type !== 'expense') {
        throw new ValidationError('Budgets can only be created for expense categories');
      }
    }

    const existing = this.budgetRepo.findByPeriodAndCategory(parsed.data.period_month, parsed.data.category_id);
    if (existing) {
      throw new ConflictError(
        `A budget for ${existing.category_name} already exists in ${parsed.data.period_month}`
      );
    }

    return this.budgetRepo.create({
      name: parsed.data.name,
      category_id: parsed.data.category_id,
      period_month: parsed.data.period_month,
      planned_amount_minor: parsed.data.planned_amount_minor,
      notes: parsed.data.notes,
    });
  }

  public updateBudget(id: string, input: unknown): BudgetWithActuals {
    this.getBudgetById(id);
    const parsed = updateBudgetSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid budget update data', parsed.error.issues);
    }
    return this.budgetRepo.update(id, parsed.data);
  }

  public deleteBudget(id: string): void {
    this.getBudgetById(id);
    this.budgetRepo.delete(id);
  }
}
