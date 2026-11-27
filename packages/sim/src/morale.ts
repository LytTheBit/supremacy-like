import type { Province, Ruleset } from './types';

export const MAX_MORALE = 100;

/** Production multiplier from morale: minProductionFactor at morale 0, 1 at full morale. */
export function moraleProductionFactor(rules: Ruleset, province: Province): number {
  const { minProductionFactor } = rules.morale;
  const share = Math.max(0, Math.min(1, province.morale / MAX_MORALE));
  return minProductionFactor + (1 - minProductionFactor) * share;
}

/** Troops can only be trained where morale is high enough. */
export function canRecruitAt(rules: Ruleset, province: Province): boolean {
  return province.morale >= rules.morale.minToRecruit;
}
