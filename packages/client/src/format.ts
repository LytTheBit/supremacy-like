import { getLocale, t } from './i18n';

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A number with a fixed count of decimals, written the way the current language does (1.5 / 1,5). */
function decimal(value: number, digits: number): string {
  const key = `${getLocale()}:${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Resource amounts are large (thousands): show them as 12.3k. */
export function formatAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return t('format.millions', { value: decimal(value / 1_000_000, 1) });
  if (abs >= 1000) return t('format.thousands', { value: decimal(value / 1000, abs >= 100_000 ? 0 : 1) });
  return String(Math.round(value));
}

export function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : '-'}${formatAmount(Math.abs(value))}`;
}

/** Income per tick, e.g. "+1.2k/t". */
export function formatRate(value: number): string {
  return t('format.perTick', { value: formatSigned(value) });
}

/** Troop counts are fractional after battles: show one decimal only when needed. */
export function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : decimal(value, 1);
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A price on the market: how much of one resource for one unit of another, e.g. 0.75 (0,75 in Italian). */
export function formatRatio(value: number): string {
  return decimal(value, 2);
}
