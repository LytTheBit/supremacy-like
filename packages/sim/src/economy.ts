import { moraleProductionFactor } from './morale';
import { isSeaProvince } from './naval';
import type { Province, ResourceId, Ruleset } from './types';

/** The resource that is money, or null when the game has no currency. */
export function currencyOf(rules: Ruleset): ResourceId | null {
  return rules.economy?.currency ?? null;
}

/** Money a province earns per tick (zero for sea provinces, which nobody owns, and for games without money). */
export function provinceMoneyIncome(rules: Ruleset, province: Province): number {
  if (!rules.economy || province.owner === null || isSeaProvince(province)) return 0;
  return rules.economy.incomePerProvince * moraleProductionFactor(rules, province);
}
