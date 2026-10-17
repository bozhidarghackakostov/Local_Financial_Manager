import type { DateFormatPreference, PeriodPreset, RecurringFrequency } from '../types/index.ts';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_REGEX = /^(\d{4})-(\d{2})$/;

/**
 * Validates that a string is a real calendar date in YYYY-MM-DD format
 * (e.g., rejects 2026-02-30 or malformed strings).
 */
export function isValidIsoDate(dateStr: string): boolean {
  const match = ISO_DATE_REGEX.exec(dateStr);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;

  const maxDays = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDays;
}

/**
 * Validates that a string is in YYYY-MM format.
 */
export function isValidIsoMonth(monthStr: string): boolean {
  const match = ISO_MONTH_REGEX.exec(monthStr);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}

export function getDaysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

/**
 * Returns today's local calendar date in YYYY-MM-DD without UTC drift.
 */
export function getTodayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the current calendar month in YYYY-MM.
 */
export function getCurrentIsoMonth(now: Date = new Date()): string {
  return getTodayIsoDate(now).slice(0, 7);
}

/**
 * Parses a YYYY-MM-DD string into { year, month, day } integers.
 */
export function parseIsoDateParts(dateStr: string): { year: number; month: number; day: number } {
  if (!isValidIsoDate(dateStr)) {
    throw new Error(`Invalid calendar date: "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/**
 * Formats { year, month, day } into YYYY-MM-DD.
 */
export function formatIsoDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Adds a signed number of days to a YYYY-MM-DD date purely in calendar arithmetic.
 */
export function addCalendarDays(dateStr: string, daysToAdd: number): string {
  const { year, month, day } = parseIsoDateParts(dateStr);
  const utc = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return formatIsoDateParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/**
 * Adds a signed number of months to a YYYY-MM-DD date, clamping the day to the end of the target month
 * (e.g., 2026-01-31 + 1 month -> 2026-02-28).
 */
export function addCalendarMonths(dateStr: string, monthsToAdd: number): string {
  const { year, month, day } = parseIsoDateParts(dateStr);
  const totalMonths = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = getDaysInMonth(targetYear, targetMonth);
  const clampedDay = Math.min(day, maxDay);
  return formatIsoDateParts(targetYear, targetMonth, clampedDay);
}

/**
 * Adds a signed number of years to a YYYY-MM-DD date, clamping Feb 29 on non-leap years to Feb 28.
 */
export function addCalendarYears(dateStr: string, yearsToAdd: number): string {
  const { year, month, day } = parseIsoDateParts(dateStr);
  const targetYear = year + yearsToAdd;
  const maxDay = getDaysInMonth(targetYear, month);
  const clampedDay = Math.min(day, maxDay);
  return formatIsoDateParts(targetYear, month, clampedDay);
}

/**
 * Advances a recurring date by one step of (frequency, intervalCount).
 */
export function advanceRecurringDate(
  dateStr: string,
  frequency: RecurringFrequency,
  intervalCount: number = 1
): string {
  if (intervalCount < 1 || !Number.isInteger(intervalCount)) {
    throw new Error('Interval count must be a positive integer');
  }
  switch (frequency) {
    case 'daily':
      return addCalendarDays(dateStr, intervalCount);
    case 'weekly':
      return addCalendarDays(dateStr, intervalCount * 7);
    case 'monthly':
      return addCalendarMonths(dateStr, intervalCount);
    case 'yearly':
      return addCalendarYears(dateStr, intervalCount);
  }
}

/**
 * Resolves a named period preset (or custom range) into inclusive [startDate, endDate] in YYYY-MM-DD.
 */
export function resolvePeriodRange(
  preset: PeriodPreset,
  referenceDateStr: string = getTodayIsoDate(),
  customStart?: string,
  customEnd?: string
): { preset: PeriodPreset; startDate: string; endDate: string } {
  const { year, month } = parseIsoDateParts(referenceDateStr);

  switch (preset) {
    case 'this_month': {
      const startDate = formatIsoDateParts(year, month, 1);
      const endDate = formatIsoDateParts(year, month, getDaysInMonth(year, month));
      return { preset, startDate, endDate };
    }
    case 'last_month': {
      const prevMonthDate = addCalendarMonths(formatIsoDateParts(year, month, 1), -1);
      const prevParts = parseIsoDateParts(prevMonthDate);
      const startDate = formatIsoDateParts(prevParts.year, prevParts.month, 1);
      const endDate = formatIsoDateParts(
        prevParts.year,
        prevParts.month,
        getDaysInMonth(prevParts.year, prevParts.month)
      );
      return { preset, startDate, endDate };
    }
    case 'last_30_days': {
      const startDate = addCalendarDays(referenceDateStr, -29);
      return { preset, startDate, endDate: referenceDateStr };
    }
    case 'last_90_days': {
      const startDate = addCalendarDays(referenceDateStr, -89);
      return { preset, startDate, endDate: referenceDateStr };
    }
    case 'this_year': {
      const startDate = formatIsoDateParts(year, 1, 1);
      const endDate = formatIsoDateParts(year, 12, 31);
      return { preset, startDate, endDate };
    }
    case 'custom': {
      if (!customStart || !customEnd || !isValidIsoDate(customStart) || !isValidIsoDate(customEnd)) {
        throw new Error('Custom period requires valid startDate and endDate in YYYY-MM-DD format');
      }
      if (customStart > customEnd) {
        throw new Error('startDate cannot be after endDate');
      }
      return { preset: 'custom', startDate: customStart, endDate: customEnd };
    }
  }
}

/**
 * Formats an ISO calendar date (YYYY-MM-DD) according to the user's display preference.
 */
export function formatDisplayDate(
  isoDate: string,
  format: DateFormatPreference = 'YYYY-MM-DD'
): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  switch (format) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
    default:
      return isoDate;
  }
}

/**
 * Parses an external date string (e.g. from CSV) into YYYY-MM-DD.
 */
export function parseExternalDateToIso(
  rawDate: string,
  format: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' = 'YYYY-MM-DD'
): string {
  const trimmed = rawDate.trim();
  if (isValidIsoDate(trimmed)) {
    return trimmed;
  }

  const slashOrDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (slashOrDash) {
    const part1 = Number(slashOrDash[1]);
    const part2 = Number(slashOrDash[2]);
    const year = Number(slashOrDash[3]);
    const day = format === 'MM/DD/YYYY' ? part2 : part1;
    const month = format === 'MM/DD/YYYY' ? part1 : part2;
    const candidate = formatIsoDateParts(year, month, day);
    if (isValidIsoDate(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Invalid date "${rawDate}" for format ${format}`);
}
