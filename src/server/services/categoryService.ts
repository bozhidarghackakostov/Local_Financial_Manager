import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { Category, CategoryType } from '../../shared/types/index.ts';
import { createCategorySchema, updateCategorySchema } from '../../shared/schemas/index.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.ts';

export class CategoryService {
  private readonly categoryRepo: CategoryRepository;
  constructor(categoryRepo: CategoryRepository) {
    this.categoryRepo = categoryRepo;
  }

  public listCategories(options: { type?: CategoryType; includeArchived?: boolean } = {}): Category[] {
    return this.categoryRepo.findAll(options);
  }

  public getCategoryById(id: string): Category {
    const category = this.categoryRepo.findById(id);
    if (!category) {
      throw new NotFoundError(`Category not found: ${id}`);
    }
    return category;
  }

  public createCategory(input: unknown): Category {
    const parsed = createCategorySchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid category data', parsed.error.issues);
    }

    const existing = this.categoryRepo.findByNameAndType(parsed.data.name, parsed.data.category_type);
    if (existing) {
      throw new ConflictError(`A ${parsed.data.category_type} category named "${parsed.data.name}" already exists`);
    }

    if (parsed.data.parent_id) {
      const parent = this.getCategoryById(parsed.data.parent_id);
      if (parent.category_type !== parsed.data.category_type) {
        throw new ValidationError('Parent category must have the same category type (income or expense)');
      }
    }

    return this.categoryRepo.create({
      name: parsed.data.name,
      category_type: parsed.data.category_type,
      parent_id: parsed.data.parent_id ?? null,
      display_order: parsed.data.display_order,
    });
  }

  public updateCategory(id: string, input: unknown): Category {
    const current = this.getCategoryById(id);
    const parsed = updateCategorySchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid category update data', parsed.error.issues);
    }

    if (parsed.data.name && parsed.data.name.toLowerCase() !== current.name.toLowerCase()) {
      const duplicate = this.categoryRepo.findByNameAndType(parsed.data.name, current.category_type);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError(`A ${current.category_type} category named "${parsed.data.name}" already exists`);
      }
    }

    if (parsed.data.parent_id) {
      if (parsed.data.parent_id === id) {
        throw new ValidationError('A category cannot be its own parent');
      }
      const parent = this.getCategoryById(parsed.data.parent_id);
      if (parent.category_type !== current.category_type) {
        throw new ValidationError('Parent category must have the same category type');
      }
    }

    return this.categoryRepo.update(id, parsed.data);
  }

  public deleteCategory(id: string, reassignToCategoryId?: string): void {
    const current = this.getCategoryById(id);
    const refCount = this.categoryRepo.countReferences(id);

    if (refCount > 0 && !reassignToCategoryId) {
      throw new ConflictError(
        `Category "${current.name}" is used by ${refCount} record(s). Provide a replacement category to reassign records, or archive the category instead.`
      );
    }

    if (reassignToCategoryId) {
      if (reassignToCategoryId === id) {
        throw new ValidationError('Cannot reassign a category to itself');
      }
      const target = this.getCategoryById(reassignToCategoryId);
      if (target.category_type !== current.category_type) {
        throw new ValidationError(`Replacement category must also be of type "${current.category_type}"`);
      }
    }

    this.categoryRepo.deleteWithOptionalReassign(id, reassignToCategoryId);
  }
}
