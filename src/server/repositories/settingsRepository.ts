import type { DatabaseManager } from '../db/connection.ts';
import type { AppSettings, DateFormatPreference, PeriodPreset } from '../../shared/types/index.ts';
import { DEFAULT_SETTINGS } from '../../../database/seed/default_categories.ts';

export class SettingsRepository {
  private readonly dbManager: DatabaseManager;
  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  public getAll(): AppSettings {
    const rows = this.dbManager.db
      .prepare('SELECT setting_key, setting_value FROM app_settings')
      .all() as Array<{ setting_key: string; setting_value: string }>;

    const map: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      map[row.setting_key] = row.setting_value;
    }

    return {
      base_currency: map.base_currency || 'USD',
      date_format: (map.date_format as DateFormatPreference) || 'YYYY-MM-DD',
      default_period: (map.default_period as PeriodPreset) || 'this_month',
    };
  }

  public update(partial: Partial<AppSettings>): AppSettings {
    const now = new Date().toISOString();
    this.dbManager.withTransaction((db) => {
      const stmt = db.prepare(`
        INSERT INTO app_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
      `);

      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) {
          stmt.run(key, String(value), now);
        }
      }

      if (partial.base_currency) {
        db.prepare('UPDATE accounts SET currency = ?').run(partial.base_currency);
        db.prepare('UPDATE transactions SET currency = ?').run(partial.base_currency);
      }
    });

    return this.getAll();
  }
}
