import type { Medal } from './medal';

/**
 * Generals: a Military Academy trains commanders that strengthen the troops of their army.
 *
 *   Major    +2% each, 10 reach the maximum (+20%)
 *   Colonel  +5% each,  4 reach the maximum (+20%)
 *   General  +20%
 *
 * The three types add up: 10 majors, 4 colonels and a general give +60%.
 * Costs and times are placeholders to be balanced.
 */
export const generalsMedal: Medal = {
  id: 'generals',
  name: 'Generals',
  description: 'Military Academies train commanders that raise the attack and defense of their army.',
  apply: (rules) => {
    rules.buildings.military_academy = {
      name: 'Military Academy',
      cost: { wood: 10000, iron: 6000, coal: 3000 },
      buildTicks: 6,
    };
    rules.units.major = {
      name: 'Major',
      attack: 0,
      defense: 1,
      hp: 10,
      speed: 1,
      cost: { grain: 6000, iron: 4000 },
      trainingTicks: 3,
      requires: { military_academy: 1 },
      commander: { bonus: 0.02, maxBonus: 0.2 },
    };
    rules.units.colonel = {
      name: 'Colonel',
      attack: 0,
      defense: 1,
      hp: 10,
      speed: 1,
      cost: { grain: 12000, iron: 10000, coal: 2000 },
      trainingTicks: 4,
      requires: { military_academy: 1 },
      commander: { bonus: 0.05, maxBonus: 0.2 },
    };
    rules.units.general = {
      name: 'General',
      attack: 0,
      defense: 1,
      hp: 10,
      speed: 1,
      cost: { grain: 30000, iron: 25000, coal: 10000 },
      trainingTicks: 6,
      requires: { military_academy: 1 },
      commander: { bonus: 0.2, maxBonus: 0.2 },
    };
    rules.commanders = { ...rules.commanders };
    return rules;
  },
};
