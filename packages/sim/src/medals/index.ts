import type { MedalId, Ruleset } from '../types';
import { generalsMedal } from './generals';
import { composeRuleset, type Medal } from './medal';

export * from './medal';
export { generalsMedal } from './generals';

/** Every medal that exists. Add new medals here. */
export const defaultMedals: Medal[] = [generalsMedal];

/** Builds the ruleset of a new game from a list of medal ids. */
export function rulesetWithMedals(base: Ruleset, ids: MedalId[], catalog: Medal[] = defaultMedals): Ruleset {
  const medals = ids.map((id) => {
    const medal = catalog.find((m) => m.id === id);
    if (!medal) throw new Error(`Unknown medal: ${id}`);
    return medal;
  });
  return composeRuleset(base, medals);
}
