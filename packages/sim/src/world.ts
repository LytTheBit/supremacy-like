import { totalCount } from './combat';
import type {
  Army,
  ArmyId,
  BuildingId,
  GameState,
  MapDef,
  PlayerId,
  ProvinceId,
  Relationship,
  ResourceId,
  Ruleset,
  TreatyKind,
  Units,
} from './types';

export interface GameSetup {
  map: MapDef;
  rules: Ruleset;
  players: { id: PlayerId; name: string }[];
  /** Initial owners. Provinces not listed start neutral. */
  owners: Record<ProvinceId, PlayerId>;
  armies: { id: ArmyId; owner: PlayerId; location: ProvinceId; units: Units }[];
  /** Buildings that already stand at the start of the game. */
  buildings?: { provinceId: ProvinceId; type: BuildingId }[];
  /** Starting resources per player. Missing players or resources start at 0. */
  stockpiles?: Record<PlayerId, Record<ResourceId, number>>;
  /** Treaties in force at the start. Pairs that are not listed start at war. */
  relations?: { a: PlayerId; b: PlayerId; kind: TreatyKind }[];
}

/** Creates a fresh game state and validates the setup against the ruleset. */
export function createGame(setup: GameSetup): GameState {
  const { map, rules } = setup;
  const provinceIds = new Set(map.provinces.map((p) => p.id));
  const playerIds = new Set(setup.players.map((p) => p.id));

  for (const province of map.provinces) {
    if (!rules.resources.includes(province.resource)) {
      throw new Error(`Province ${province.id} uses unknown resource: ${province.resource}`);
    }
  }
  const { morale } = rules;
  for (const [name, value] of Object.entries({
    start: morale.start,
    afterConquest: morale.afterConquest,
    minToRecruit: morale.minToRecruit,
  })) {
    if (!(value >= 0 && value <= 100)) throw new Error(`morale.${name} must be between 0 and 100`);
  }
  if (!(morale.minProductionFactor >= 0 && morale.minProductionFactor <= 1)) {
    throw new Error('morale.minProductionFactor must be between 0 and 1');
  }
  if (!(morale.recoveryPerTick >= 0)) throw new Error('morale.recoveryPerTick must not be negative');
  if (!(rules.victory.provinceShare > 0.5 && rules.victory.provinceShare <= 1)) {
    throw new Error('victory.provinceShare must be in (0.5, 1]');
  }
  const { diplomacy } = rules;
  if (!(Number.isInteger(diplomacy.truceTicks) && diplomacy.truceTicks > 0)) {
    throw new Error('diplomacy.truceTicks must be a positive integer');
  }
  if (!(Number.isInteger(diplomacy.warNoticeTicks) && diplomacy.warNoticeTicks >= 0)) {
    throw new Error('diplomacy.warNoticeTicks must be a non-negative integer');
  }
  if (!(Number.isInteger(diplomacy.proposalTicks) && diplomacy.proposalTicks > 0)) {
    throw new Error('diplomacy.proposalTicks must be a positive integer');
  }
  for (const [type, def] of Object.entries(rules.units)) {
    for (const resource of Object.keys(def.cost)) {
      if (!rules.resources.includes(resource)) {
        throw new Error(`Unit ${type} costs unknown resource: ${resource}`);
      }
    }
  }
  for (const [type, def] of Object.entries(rules.buildings)) {
    for (const resource of Object.keys(def.cost)) {
      if (!rules.resources.includes(resource)) {
        throw new Error(`Building ${type} costs unknown resource: ${resource}`);
      }
    }
  }
  for (const [type, def] of Object.entries(rules.units)) {
    if (def.requires !== undefined && !rules.buildings[def.requires]) {
      throw new Error(`Unit ${type} requires unknown building: ${def.requires}`);
    }
  }
  for (const edge of map.edges) {
    if (!provinceIds.has(edge.a) || !provinceIds.has(edge.b)) {
      throw new Error(`Edge ${edge.a}-${edge.b} references an unknown province`);
    }
    if (edge.distance <= 0) {
      throw new Error(`Edge ${edge.a}-${edge.b} must have a positive distance`);
    }
  }
  for (const [provinceId, ownerId] of Object.entries(setup.owners)) {
    if (!provinceIds.has(provinceId)) throw new Error(`Unknown province in owners: ${provinceId}`);
    if (!playerIds.has(ownerId)) throw new Error(`Unknown player in owners: ${ownerId}`);
  }

  const armyIds = new Set<ArmyId>();
  const armies: Army[] = setup.armies.map((army) => {
    if (armyIds.has(army.id)) throw new Error(`Duplicate army id: ${army.id}`);
    armyIds.add(army.id);
    if (!playerIds.has(army.owner)) throw new Error(`Army ${army.id} has unknown owner`);
    if (!provinceIds.has(army.location)) throw new Error(`Army ${army.id} has unknown location`);
    if (totalCount(army.units) <= 0) throw new Error(`Army ${army.id} has no units`);
    for (const type of Object.keys(army.units)) {
      if (!rules.units[type]) throw new Error(`Army ${army.id} has unknown unit type: ${type}`);
    }
    return { ...army, units: { ...army.units }, order: null };
  });

  const startingBuildings = new Map<ProvinceId, BuildingId[]>();
  for (const building of setup.buildings ?? []) {
    if (!provinceIds.has(building.provinceId)) {
      throw new Error(`Building ${building.type} is placed in unknown province: ${building.provinceId}`);
    }
    if (!rules.buildings[building.type]) throw new Error(`Unknown building type: ${building.type}`);
    const list = startingBuildings.get(building.provinceId) ?? [];
    if (list.includes(building.type)) {
      throw new Error(`Duplicate ${building.type} in province ${building.provinceId}`);
    }
    list.push(building.type);
    startingBuildings.set(building.provinceId, list);
  }

  for (const [playerId, stock] of Object.entries(setup.stockpiles ?? {})) {
    if (!playerIds.has(playerId)) throw new Error(`Stockpile for unknown player: ${playerId}`);
    for (const [resource, amount] of Object.entries(stock)) {
      if (!rules.resources.includes(resource)) throw new Error(`Stockpile has unknown resource: ${resource}`);
      if (!(amount >= 0)) throw new Error(`Stockpile of ${resource} must not be negative`);
    }
  }

  const relations: Relationship[] = [];
  for (const treaty of setup.relations ?? []) {
    if (!playerIds.has(treaty.a) || !playerIds.has(treaty.b)) throw new Error('Treaty between unknown players');
    if (treaty.a === treaty.b) throw new Error('A player cannot have a treaty with themselves');
    const [a, b] = treaty.a < treaty.b ? [treaty.a, treaty.b] : [treaty.b, treaty.a];
    if (relations.some((r) => r.a === a && r.b === b)) throw new Error(`Duplicate treaty between ${a} and ${b}`);
    const relation: Relationship = { a, b, kind: treaty.kind };
    if (treaty.kind === 'truce') relation.until = rules.diplomacy.truceTicks;
    relations.push(relation);
  }
  relations.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const emptyStockpile = Object.fromEntries(rules.resources.map((r) => [r, 0]));

  return {
    rulesId: rules.id,
    tick: 0,
    players: setup.players.map((p) => ({
      id: p.id,
      name: p.name,
      stockpile: { ...emptyStockpile, ...(setup.stockpiles?.[p.id] ?? {}) },
    })),
    provinces: map.provinces.map((p) => ({
      ...p,
      owner: setup.owners[p.id] ?? null,
      buildings: [...(startingBuildings.get(p.id) ?? [])],
      morale: rules.morale.start,
    })),
    edges: map.edges.map((e) => ({ ...e })),
    armies,
    recruitQueue: [],
    constructionQueue: [],
    relations,
    proposals: [],
    nextId: 1,
    eliminated: [],
    outcome: null,
    events: [],
  };
}
