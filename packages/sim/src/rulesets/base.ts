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
      vision: 2.5,
      vs: { air: 0.25 }, // rifles against aircraft
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
      vision: 1.5,
      vs: { air: 0 }, // cannot shoot at aircraft
    },
    // Sea units are trained in a port and sail through sea provinces.
    cruiser: {
      name: 'Cruiser',
      domain: 'sea',
      attack: 5,
      defense: 3,
      hp: 20,
      speed: 1.5,
      cost: { iron: 5000, coal: 3000 },
      trainingTicks: 5,
      requires: 'port',
      vision: 3,
      vs: { air: 0.5 },
      bombard: 3, // light guns: a nuisance for troops on the coast
    },
    // Heavy guns: the best way to clear a coast. Slow and expensive.
    battleship: {
      name: 'Battleship',
      domain: 'sea',
      attack: 8,
      defense: 6,
      hp: 35,
      speed: 1,
      cost: { iron: 9000, coal: 6000 },
      trainingTicks: 8,
      requires: 'port',
      vision: 3,
      vs: { air: 0.4 },
      bombard: 10,
    },
    // Aircraft are trained in an airfield, fly over everything within `range` of an airbase and
    // fly back on their own. Fighters beat aircraft, bombers beat everything on the ground and sea.
    fighter: {
      name: 'Fighter',
      domain: 'air',
      attack: 4,
      defense: 4,
      hp: 8,
      speed: 3,
      range: 6,
      cost: { iron: 3000, coal: 2000 },
      trainingTicks: 4,
      requires: 'airfield',
      vision: 4,
      vs: { land: 0.5, sea: 0.5, air: 1.5 },
    },
    bomber: {
      name: 'Bomber',
      domain: 'air',
      attack: 9,
      defense: 1,
      hp: 10,
      speed: 2,
      range: 8,
      cost: { iron: 5000, coal: 3000, wood: 1000 },
      trainingTicks: 6,
      requires: 'airfield',
      vision: 3,
      vs: { land: 1.5, sea: 1.5, air: 0.3 },
    },
    // Does not fight well, but carries up to 10 land units per ship.
    transport: {
      name: 'Transport',
      domain: 'sea',
      attack: 0,
      defense: 1,
      hp: 15,
      speed: 1.2,
      capacity: 10,
      cost: { wood: 4000, iron: 2000 },
      trainingTicks: 4,
      requires: 'port',
      vision: 2,
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
    // Coastal only. Required to train ships; ships can dock here.
    port: {
      name: 'Port',
      cost: { wood: 6000, iron: 3000 },
      buildTicks: 4,
      coastal: true,
      harbor: true,
    },
    // Aircraft are trained here and can land here.
    airfield: {
      name: 'Airfield',
      cost: { wood: 5000, iron: 3000 },
      buildTicks: 4,
      airbase: true,
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
  vision: {
    fog: true,
    provinceRadius: 2.5,
    unitRadius: 2,
  },
  // Spies: placeholders to be balanced. They cost resources the army hardly uses (wood, grain).
  espionage: {
    cost: { grain: 2000, wood: 2000 },
    maxSpies: 3,
    infiltrateTicks: 3,
    coverTicks: 30,
    sabotage: { ticks: 4 },
    disinformation: { ticks: 3, moraleDamage: 30 },
  },
};
