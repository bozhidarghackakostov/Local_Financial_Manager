import { describe, it, expect } from 'vitest';
import {
  parseDecimalToMinorUnits,
  minorUnitsToDecimalString,
  formatMinorUnits,
  calculatePercentage,
} from '../../src/shared/utils/money.ts';
import {
  isValidIsoDate,
  addCalendarDays,
  addCalendarMonths,
  advanceRecurringDate,
  resolvePeriodRange,
  parseExternalDateToIso,
  formatDisplayDate,
} from '../../src/shared/utils/dates.ts';

describe('Money Utilities — Integer Minor Units', () => {
  it('converts decimal strings into exact integer minor units without floating-point errors', () => {
    expect(parseDecimalToMinorUnits('1000.00')).toBe(100000);
    expect(parseDecimalToMinorUnits('19.99')).toBe(1999);
    expect(parseDecimalToMinorUnits('1,250.75')).toBe(125075);
    expect(parseDecimalToMinorUnits('0.01')).toBe(1);
    expect(parseDecimalToMinorUnits('42.5')).toBe(4250);
    expect(parseDecimalToMinorUnits('500')).toBe(50000);
  });

  it('supports European comma decimal separator when configured', () => {
    expect(parseDecimalToMinorUnits('1.250,75', { decimalSeparator: ',' })).toBe(125075);
    expect(parseDecimalToMinorUnits('-45,10', { decimalSeparator: ',', allowNegative: true })).toBe(-4510);
  });

  it('rejects invalid, non-finite, zero (when disallowed), negative (when disallowed), or >2 decimal inputs', () => {
    expect(() => parseDecimalToMinorUnits('')).toThrow();
    expect(() => parseDecimalToMinorUnits('abc')).toThrow();
    expect(() => parseDecimalToMinorUnits('12.345')).toThrow();
    expect(() => parseDecimalToMinorUnits('0.00')).toThrow();
    expect(parseDecimalToMinorUnits('0.00', { allowZero: true })).toBe(0);
    expect(() => parseDecimalToMinorUnits('-10.00')).toThrow();
    expect(parseDecimalToMinorUnits('-10.00', { allowNegative: true })).toBe(-1000);
    expect(() => parseDecimalToMinorUnits(Number.NaN)).toThrow();
    expect(() => parseDecimalToMinorUnits(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('formats minor units back to decimal and currency strings accurately', () => {
    expect(minorUnitsToDecimalString(150000)).toBe('1500.00');
    expect(minorUnitsToDecimalString(5)).toBe('0.05');
    expect(minorUnitsToDecimalString(-12050)).toBe('-120.50');

    expect(formatMinorUnits(150000, 'USD')).toBe('$1,500.00');
    expect(formatMinorUnits(-12050, 'USD')).toBe('-$120.50');
    expect(formatMinorUnits(50000, 'EUR', { showExplicitSign: true })).toBe('+€500.00');
  });

  it('calculates percentages with deterministic rounding', () => {
    expect(calculatePercentage(5000, 10000)).toBe(50);
    expect(calculatePercentage(3333, 10000)).toBe(33.33);
    expect(calculatePercentage(0, 10000)).toBe(0);
    expect(calculatePercentage(5000, 0)).toBe(0);
  });
});

describe('Calendar Date & Period Utilities', () => {
  it('validates real calendar dates and rejects impossible dates', () => {
    expect(isValidIsoDate('2026-10-17')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true); // Leap year
    expect(isValidIsoDate('2026-02-29')).toBe(false); // Non-leap year
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('17/10/2026')).toBe(false);
  });

  it('performs calendar arithmetic without UTC timezone day-shift bugs', () => {
    expect(addCalendarDays('2026-10-17', 1)).toBe('2026-10-18');
    expect(addCalendarDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(advanceRecurringDate('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
    expect(advanceRecurringDate('2026-01-15', 'weekly', 2)).toBe('2026-01-29');
  });

  it('resolves named and custom periods accurately', () => {
    expect(resolvePeriodRange('this_month', '2026-10-17')).toEqual({
      preset: 'this_month',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    expect(resolvePeriodRange('last_month', '2026-10-17')).toEqual({
      preset: 'last_month',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    expect(resolvePeriodRange('this_year', '2026-10-17')).toEqual({
      preset: 'this_year',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    expect(() => resolvePeriodRange('custom', '2026-10-17', '2026-10-20', '2026-10-01')).toThrow();
  });

  it('parses external CSV dates and formats display dates', () => {
    expect(parseExternalDateToIso('17/10/2026', 'DD/MM/YYYY')).toBe('2026-10-17');
    expect(parseExternalDateToIso('10/17/2026', 'MM/DD/YYYY')).toBe('2026-10-17');
    expect(formatDisplayDate('2026-10-17', 'DD/MM/YYYY')).toBe('17/10/2026');
  });
});
