import type { MedalId, Ruleset } from '../types';

/**
 * A medal is an optional rule set chosen when a game is created. It changes the ruleset
 * (new units, buildings, mechanics) before the game starts; it never changes during a game.
 */
export interface Medal {
  id: MedalId;
  name: string;
  description: string;
  /** Eras this medal can be added to. Omit when it works in every era. */
  eras?: string[];
  /** Medals that must be added BEFORE this one in the list. */
  requires?: MedalId[];
  /** Medals that cannot be combined with this one. */
  conflicts?: MedalId[];
  /** Receives a private copy of the ruleset and returns the modified ruleset. */
  apply: (rules: Ruleset) => Ruleset;
}

/**
 * Applies medals, in order, on top of a ruleset. The base ruleset is never modified.
 * The result gets the id `<base>+<medal>+...`, so a game can only be played with the
 * ruleset it was created with.
 */
export function composeRuleset(base: Ruleset, medals: Medal[]): Ruleset {
  const added = new Set<MedalId>(base.medals);
  let rules = structuredClone(base);

  for (const medal of medals) {
    if (added.has(medal.id)) throw new Error(`Medal "${medal.id}" is added more than once`);
    if (medal.eras && !medal.eras.includes(rules.era)) {
      throw new Error(`Medal "${medal.id}" is not available in the ${rules.era} era`);
    }
    for (const required of medal.requires ?? []) {
      if (!added.has(required)) throw new Error(`Medal "${medal.id}" requires "${required}" to be added first`);
    }
    for (const conflict of medal.conflicts ?? []) {
      if (added.has(conflict)) throw new Error(`Medal "${medal.id}" cannot be combined with "${conflict}"`);
    }

    rules = medal.apply(structuredClone(rules));
    added.add(medal.id);
    rules.medals = [...rules.medals.filter((id) => id !== medal.id), medal.id];
    rules.id = `${rules.id}+${medal.id}`;
  }
  return rules;
}
