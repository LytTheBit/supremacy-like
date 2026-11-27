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
  resources: ['money', 'wood', 'iron', 'grain', 'coal'],
  units: {
    infantry: {
      name: 'Infantry',
      attack: 2,
      defense: 2,
      hp: 10,
      speed: 1,
      cost: { grain: 2000, iron: 1000 },
      trainingTicks: 2,
      requires: { recruitment_office: 1 },
      vision: 2.5,
      vs: { air: 0.25 }, // rifles against aircraft
    },
    // Fast and expensive in grain and wood (horses). Needs the whole recruiting chain up to a workshop.
    cavalry: {
      name: 'Cavalry',
      attack: 3,
      defense: 1.5,
      hp: 8,
      speed: 2,
      cost: { grain: 3000, wood: 1000, iron: 500 },
      trainingTicks: 3,
      requires: { recruitment_office: 1, barracks: 1, workshop: 1 },
      vision: 3,
      vs: { air: 0.1 },
    },
    // Light, fast and good at scouting; its machine guns can also fire at aircraft.
    armored_car: {
      name: 'Armored car',
      attack: 4,
      defense: 3,
      hp: 10,
      speed: 2.5,
      cost: { iron: 3000, coal: 1500 },
      trainingTicks: 3,
      requires: { workshop: 1 },
      vision: 3,
      vs: { air: 0.5 },
    },
    artillery: {
      name: 'Artillery',
      attack: 6,
      defense: 1,
      hp: 6,
      speed: 0.5,
      cost: { iron: 3000, coal: 2000 },
      trainingTicks: 4,
      requires: { factory: 1 },
      vision: 1.5,
      vs: { air: 0 }, // cannot shoot at aircraft
    },
    tank: {
      name: 'Tank',
      attack: 7,
      defense: 5,
      hp: 18,
      speed: 1,
      cost: { iron: 5000, coal: 3000 },
      trainingTicks: 5,
      requires: { factory: 2 },
      vision: 2,
      vs: { air: 0 },
    },
    // The strongest ground unit: slow, huge and ruinously expensive. Needs a fully developed factory.
    heavy_tank: {
      name: 'Heavy tank',
      attack: 12,
      defense: 9,
      hp: 35,
      speed: 0.7,
      cost: { iron: 9000, coal: 5000, wood: 1000 },
      trainingTicks: 8,
      requires: { factory: 4 },
      vision: 2,
      vs: { air: 0 },
    },
    // Enormous firepower, but it only runs on rails: it moves between provinces that both have a railway.
    railway_gun: {
      name: 'Railway gun',
      attack: 14,
      defense: 1,
      hp: 8,
      speed: 1,
      cost: { iron: 10000, coal: 6000 },
      trainingTicks: 9,
      requires: { factory: 3, railway: 1 },
      railOnly: true,
      vision: 1.5,
      vs: { air: 0 },
    },
    // Does not fight: it sees far, but it is a land unit, so it can take an undefended province.
    balloon: {
      name: 'Observation balloon',
      attack: 0,
      defense: 0,
      hp: 3,
      speed: 0.5,
      cost: { wood: 2000, coal: 1000 },
      trainingTicks: 2,
      requires: { workshop: 2 },
      vision: 5,
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
      requires: { port: 1 },
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
      requires: { port: 1 },
      vision: 3,
      vs: { air: 0.4 },
      bombard: 10,
    },
    // Hunts ships and cannot hurt troops on land or aircraft. Hidden from enemies that are not close.
    submarine: {
      name: 'Submarine',
      domain: 'sea',
      attack: 6,
      defense: 2,
      hp: 12,
      speed: 1.5,
      cost: { iron: 5000, coal: 2000 },
      trainingTicks: 5,
      requires: { port: 1, factory: 2 },
      vision: 2,
      vs: { land: 0, sea: 1.5, air: 0 },
      stealth: true,
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
      requires: { airfield: 1 },
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
      requires: { airfield: 1 },
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
      requires: { port: 1 },
      vision: 2,
    },
  },
  buildings: {
    // Required to train infantry. Every province a player starts with has one (`startingBuildings`).
    recruitment_office: {
      name: 'Recruitment office',
      cost: { wood: 2000, grain: 500 },
      buildTicks: 2,
    },
    // Units trained in a province with a barracks take less time. Needs a recruitment office.
    barracks: {
      name: 'Barracks',
      cost: { wood: 4000, iron: 2000 },
      buildTicks: 3,
      requires: { recruitment_office: 1 },
      trainingTimeMultiplier: 0.5,
      upgrades: [
        { cost: { wood: 6000, iron: 3000 }, buildTicks: 4, trainingTimeMultiplier: 0.4 },
        { cost: { wood: 8000, iron: 4000 }, buildTicks: 5, trainingTimeMultiplier: 0.33 },
      ],
    },
    // First step of the industry: unlocks the light vehicles and, from level 2, balloons and the factory.
    // +50% production of the province, a little more at each level.
    workshop: {
      name: 'Workshop',
      cost: { wood: 5000, coal: 1000 },
      buildTicks: 4,
      requires: { barracks: 1 },
      productionMultiplier: 1.5,
      upgrades: [
        { cost: { wood: 7000, coal: 2000, iron: 1000 }, buildTicks: 5, productionMultiplier: 1.6 },
        { cost: { wood: 9000, coal: 3000, iron: 2000 }, buildTicks: 6, productionMultiplier: 1.7 },
      ],
    },
    // Heavy industry. Needs a workshop of level 2 (level 3 from its third level on). The level decides
    // which units it unlocks: artillery 1, tanks 2, railway guns 3, heavy tanks 4.
    factory: {
      name: 'Factory',
      cost: { wood: 6000, iron: 4000, coal: 2000 },
      buildTicks: 5,
      requires: { workshop: 2 },
      productionMultiplier: 1.1,
      upgrades: [
        { cost: { wood: 8000, iron: 6000, coal: 3000 }, buildTicks: 6, productionMultiplier: 1.15 },
        {
          cost: { wood: 10000, iron: 8000, coal: 4000 },
          buildTicks: 7,
          requires: { workshop: 3 },
          productionMultiplier: 1.2,
        },
        {
          cost: { wood: 12000, iron: 10000, coal: 5000 },
          buildTicks: 8,
          requires: { workshop: 3 },
          productionMultiplier: 1.25,
        },
      ],
    },
    // Stops part of the damage done to the troops of its owner (and allies) in the province:
    // 50% at level 1 up to 90% at level 5.
    fortress: {
      name: 'Fortress',
      cost: { wood: 3000, iron: 3000 },
      buildTicks: 4,
      requires: { barracks: 1 },
      damageReduction: 0.5,
      upgrades: [
        { cost: { wood: 4000, iron: 4000 }, buildTicks: 5, damageReduction: 0.6 },
        { cost: { wood: 5000, iron: 5000 }, buildTicks: 6, damageReduction: 0.7 },
        { cost: { wood: 6000, iron: 6000 }, buildTicks: 7, damageReduction: 0.8 },
        { cost: { wood: 8000, iron: 8000 }, buildTicks: 8, damageReduction: 0.9 },
      ],
    },
    // Troops of the owner (and allies) cross between two provinces that both have one twice as fast.
    // Railway guns can only travel on it.
    railway: {
      name: 'Railway',
      cost: { wood: 5000, iron: 2000 },
      buildTicks: 3,
      productionMultiplier: 1.1,
      railSpeedFactor: 2,
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
  },
  // Every province a player starts with in a skirmish has these (level 1).
  startingBuildings: ['recruitment_office'],
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
    stealthRadius: 1,
  },
  // Spies: placeholders to be balanced. They cost resources the army hardly uses (wood, grain).
  espionage: {
    cost: { grain: 2000, wood: 2000 },
    maxSpies: 3,
    infiltrateTicks: 3,
    coverTicks: 30,
    sabotage: { ticks: 4 },
    disinformation: { ticks: 3, moraleDamage: 30 },
    chatContext: 6, // messages before the spy arrived that it also reads
  },
  // Money: every owned land province earns it, scaled by its morale. Nothing costs money yet: it is traded,
  // gifted and bartered; add `money` to a cost (unit, building, spy) to make it a sink.
  economy: { currency: 'money', incomePerProvince: 1000 },
  // Talking between players.
  chat: { maxMessages: 200, maxTextLength: 400, maxOpenTrades: 3 },
  // Market: placeholders to be balanced. Amounts are in the same thousands as everything else.
  market: {
    maxOrders: 5,
    orderTicks: 40,
    minAmount: 500,
  },
};
