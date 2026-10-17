import type { SettingsRepository } from '../repositories/settingsRepository.ts';
import type { AppSettings } from '../../shared/types/index.ts';
import { updateSettingsSchema } from '../../shared/schemas/index.ts';
import { ValidationError } from '../errors/index.ts';

export class SettingsService {
  private readonly settingsRepo: SettingsRepository;
  constructor(settingsRepo: SettingsRepository) {
    this.settingsRepo = settingsRepo;
  }

  public getSettings(): AppSettings {
    return this.settingsRepo.getAll();
  }

  public updateSettings(input: unknown): AppSettings {
    const parsed = updateSettingsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid settings input', parsed.error.issues);
    }
    return this.settingsRepo.update(parsed.data as Partial<AppSettings>);
  }
}
