import { SUPPORTED_CURRENCIES } from '../constants/index.ts';

/**
 * Deterministically parses a human-entered decimal string (e.g. "1,250.75", "-45.10", "100")
 * into integer minor units (e.g. 125075, -4510, 10000) without floating-point arithmetic.
 */
export function parseDecimalToMinorUnits(
  input: string | number,
  options: { allowNegative?: boolean; allowZero?: boolean; decimalSeparator?: '.' | ',' } = {}
): number {
  const { allowNegative = false, allowZero = false, decimalSeparator = '.' } = options;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Amount must be a finite value');
    }
    input = input.toFixed(2);
  }

  if (typeof input !== 'string') {
    throw new Error('Amount must be a string or finite number');
  }

  let normalized = input.trim();
  if (!normalized) {
    throw new Error('Amount cannot be empty');
  }

  // Strip currency symbols and spaces
  normalized = normalized.replace(/[$€£\s]/g, '');

  if (decimalSeparator === ',') {
    // Remove '.' thousands separators and convert ',' decimal separator to '.'
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    // Remove ',' thousands separators
    normalized = normalized.replace(/,/g, '');
  }

  const match = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid monetary amount format: "${input}". Use up to 2 decimal places.`);
  }

  const signStr = match[1];
  const wholePartStr = match[2];
  const fracPartStr = (match[3] ?? '').padEnd(2, '0');

  const isNegative = signStr === '-';
  if (isNegative && !allowNegative) {
    throw new Error('Amount cannot be negative');
  }

  const wholeUnits = BigInt(wholePartStr);
  const fracUnits = BigInt(fracPartStr);
  const totalMinorBig = (wholeUnits * 100n + fracUnits) * (isNegative ? -1n : 1n);

  if (
    totalMinorBig > BigInt(Number.MAX_SAFE_INTEGER) ||
    totalMinorBig < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error('Amount exceeds safe integer bounds');
  }

  const result = Number(totalMinorBig);

  if (!allowZero && result === 0) {
    throw new Error('Amount must be greater than zero');
  }

  return result;
}

/**
 * Formats integer minor units into a fixed 2-decimal string (e.g. 125075 -> "1250.75").
 */
export function minorUnitsToDecimalString(minorUnits: number): string {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Expected integer minor units, received: ${minorUnits}`);
  }
  const isNegative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  return `${isNegative ? '-' : ''}${major}.${String(minor).padStart(2, '0')}`;
}

/**
 * Formats integer minor units with currency symbol and thousands separators
 * (e.g. 150000, 'USD' -> "$1,500.00", -12050, 'USD' -> "-$120.50").
 */
export function formatMinorUnits(
  minorUnits: number,
  currencyCode: string = 'USD',
  options: { showExplicitSign?: boolean } = {}
): string {
  if (!Number.isFinite(minorUnits)) {
    return '$0.00';
  }
  const rounded = Math.trunc(minorUnits);
  const isNegative = rounded < 0;
  const abs = Math.abs(rounded);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;

  const currencyMeta = SUPPORTED_CURRENCIES.find((c) => c.code === currencyCode);
  const symbol = currencyMeta ? currencyMeta.symbol : `${currencyCode} `;

  const formattedMajor = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formattedNumber = `${formattedMajor}.${String(minor).padStart(2, '0')}`;

  let prefix = '';
  if (isNegative) {
    prefix = '-';
  } else if (options.showExplicitSign && rounded > 0) {
    prefix = '+';
  }

  if (currencyCode === 'BGN') {
    return `${prefix}${formattedNumber} ${symbol}`;
  }
  return `${prefix}${symbol}${formattedNumber}`;
}

/**
 * Computes percentage with deterministic half-up rounding to 2 decimal places.
 */
export function calculatePercentage(numeratorMinor: number, denominatorMinor: number): number {
  if (denominatorMinor <= 0 || numeratorMinor <= 0) {
    return 0;
  }
  // Multiply by 10000 for 2 decimal places of percentage
  return Math.round((numeratorMinor / denominatorMinor) * 10000) / 100;
}
