import type { Ruleset } from '../types';

/**
 * Minimal base ruleset. Numbers are placeholders to be balanced later.
 * Eras and medals will be applied as modifiers on top of this object.
 */
export const baseRuleset: Ruleset = {
  id: 'base',
  resources: ['wood', 'iron', 'grain', 'coal'],
  units: {
    infantry: {
      name: 'Infantry',
      attack: 2,
      defense: 2,
      hp: 10,
      speed: 1,
      cost: { grain: 2, iron: 1 },
      trainingTicks: 2,
    },
    artillery: {
      name: 'Artillery',
      attack: 6,
      defense: 1,
      hp: 6,
      speed: 0.5,
      cost: { iron: 3, coal: 2 },
      trainingTicks: 4,
    },
  },
  combat: {
    damageScale: 1,
    minUnitsAlive: 0.5,
  },
  victory: {
    provinceShare: 0.6,
  },
};
