import type { Ruleset } from '../types';

/**
 * Minimal base ruleset. Numbers are placeholders to be balanced later.
 * Resource amounts (production, costs, stockpiles) are expressed in thousands of units,
 * which leaves room for fractions and for resource chains later on.
 * Eras and medals will be applied as modifiers on top of this object.
 */
export const baseRuleset: Ruleset = {
  id: 'base',
  era: 'ww1',
  medals: [],
  resources: ['wood', 'iron', 'grain', 'coal'],
  units: {
    infantry: {
      name: 'Infantry',
      attack: 2,
      defense: 2,
      hp: 10,
      speed: 1,
      cost: { grain: 2000, iron: 1000 },
      trainingTicks: 2,
    },
    artillery: {
      name: 'Artillery',
      attack: 6,
      defense: 1,
      hp: 6,
      speed: 0.5,
      cost: { iron: 3000, coal: 2000 },
      trainingTicks: 4,
      requires: 'factory',
    },
  },
  buildings: {
    // Units trained in a province with a barracks take half the time.
    barracks: {
      name: 'Barracks',
      cost: { wood: 4000, iron: 2000 },
      buildTicks: 3,
      trainingTimeMultiplier: 0.5,
    },
    // Required to train artillery.
    factory: {
      name: 'Factory',
      cost: { wood: 6000, iron: 4000, coal: 2000 },
      buildTicks: 5,
    },
    // +50% production of the province.
    workshop: {
      name: 'Workshop',
      cost: { wood: 5000, coal: 1000 },
      buildTicks: 4,
      productionMultiplier: 1.5,
    },
  },
  combat: {
    damageScale: 1,
    minUnitsAlive: 0.5,
  },
  morale: {
    start: 100,
    afterConquest: 25,
    recoveryPerTick: 2,
    minProductionFactor: 0.25,
    minToRecruit: 50,
  },
  victory: {
    provinceShare: 0.6,
  },
  diplomacy: {
    truceTicks: 60,
    warNoticeTicks: 5,
    proposalTicks: 30,
  },
};
