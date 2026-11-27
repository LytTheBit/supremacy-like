import { maxBuildingLevel } from './buildings';
import { totalCount } from './combat';
import { armyKind, cargoFits, hasAirUnits, hasNavalUnits, isSeaProvince, splitByDomain } from './naval';
import type {
  Army,
  ArmyId,
  BuildingDef,
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
  /** Buildings that already stand at the start of the game (`level` defaults to 1). */
  buildings?: { provinceId: ProvinceId; type: BuildingId; level?: number }[];
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
    if (province.terrain !== undefined && province.terrain !== 'land' && province.terrain !== 'sea') {
      throw new Error(`Province ${province.id} has an unknown terrain: ${String(province.terrain)}`);
    }
    if (isSeaProvince(province) && province.production !== 0) {
      throw new Error(`Sea province ${province.id} cannot produce resources`);
    }
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
  if (rules.market) {
    const { maxOrders, orderTicks, minAmount } = rules.market;
    if (!(Number.isInteger(maxOrders) && maxOrders > 0)) throw new Error('market.maxOrders must be a positive integer');
    if (!(Number.isInteger(orderTicks) && orderTicks > 0)) throw new Error('market.orderTicks must be a positive integer');
    if (!(minAmount >= 0)) throw new Error('market.minAmount must not be negative');
  }
  if (rules.economy) {
    if (!rules.resources.includes(rules.economy.currency)) throw new Error('economy.currency must be one of the resources');
    if (!(rules.economy.incomePerProvince >= 0)) throw new Error('economy.incomePerProvince must not be negative');
  }
  if (rules.chat) {
    const { maxMessages, maxTextLength, maxOpenTrades } = rules.chat;
    if (!(Number.isInteger(maxMessages) && maxMessages > 0)) throw new Error('chat.maxMessages must be a positive integer');
    if (!(Number.isInteger(maxTextLength) && maxTextLength > 0)) throw new Error('chat.maxTextLength must be a positive integer');
    if (!(Number.isInteger(maxOpenTrades) && maxOpenTrades > 0)) throw new Error('chat.maxOpenTrades must be a positive integer');
  }
  const { vision } = rules;
  if (!(vision.provinceRadius >= 0)) throw new Error('vision.provinceRadius must not be negative');
  if (!(vision.unitRadius >= 0)) throw new Error('vision.unitRadius must not be negative');
  for (const [type, def] of Object.entries(rules.units)) {
    if (def.vision !== undefined && !(def.vision >= 0)) throw new Error(`Unit ${type} has a negative vision`);
  }
  for (const [type, def] of Object.entries(rules.units)) {
    for (const resource of Object.keys(def.cost)) {
      if (!rules.resources.includes(resource)) {
        throw new Error(`Unit ${type} costs unknown resource: ${resource}`);
      }
    }
  }
  for (const [type, def] of Object.entries(rules.buildings)) {
    const steps = [def, ...(def.upgrades ?? [])];
    for (const step of steps) {
      for (const resource of Object.keys(step.cost)) {
        if (!rules.resources.includes(resource)) {
          throw new Error(`Building ${type} costs unknown resource: ${resource}`);
        }
      }
      if (!(step.buildTicks >= 1)) throw new Error(`Building ${type} needs at least 1 build tick per level`);
      for (const [needed, level] of Object.entries(step.requires ?? {})) {
        const other = rules.buildings[needed];
        if (!other) throw new Error(`Building ${type} requires unknown building: ${needed}`);
        if (needed === type) throw new Error(`Building ${type} cannot require itself`);
        if (!Number.isInteger(level) || level < 1 || level > maxBuildingLevel(other)) {
          throw new Error(`Building ${type} requires ${needed} at an impossible level: ${level}`);
        }
      }
    }
    if (def.damageReduction !== undefined && !(def.damageReduction >= 0 && def.damageReduction <= 1)) {
      throw new Error(`Building ${type}: damageReduction must be between 0 and 1`);
    }
    if (def.railSpeedFactor !== undefined && !(def.railSpeedFactor >= 1)) {
      throw new Error(`Building ${type}: railSpeedFactor must be at least 1`);
    }
  }
  for (const id of rules.startingBuildings ?? []) {
    if (!rules.buildings[id]) throw new Error(`startingBuildings has an unknown building: ${id}`);
  }
  for (const [type, def] of Object.entries(rules.units)) {
    if (def.domain === 'air' && !(def.range !== undefined && def.range > 0)) {
      throw new Error(`Air unit ${type} needs a positive range`);
    }
    if (def.bombard !== undefined && !(def.bombard >= 0 && def.domain === 'sea')) {
      throw new Error(`Unit ${type}: only sea units can have a non-negative bombard value`);
    }
    if (def.range !== undefined && def.domain !== 'air') throw new Error(`Unit ${type}: only air units have a range`);
    if (def.domain !== undefined && def.domain !== 'land' && def.domain !== 'sea' && def.domain !== 'air') {
      throw new Error(`Unit ${type} has an unknown domain: ${String(def.domain)}`);
    }
    if (def.capacity !== undefined && !(def.capacity >= 0 && def.domain === 'sea')) {
      throw new Error(`Unit ${type}: only sea units can have a non-negative capacity`);
    }
  }
  for (const [type, def] of Object.entries(rules.units)) {
    for (const [needed, level] of Object.entries(def.requires ?? {})) {
      const building = rules.buildings[needed];
      if (!building) throw new Error(`Unit ${type} requires unknown building: ${needed}`);
      if (!Number.isInteger(level) || level < 1 || level > maxBuildingLevel(building)) {
        throw new Error(`Unit ${type} requires ${needed} at an impossible level: ${level}`);
      }
    }
    if (def.railOnly && (def.domain ?? 'land') !== 'land') throw new Error(`Unit ${type}: only land units can be railOnly`);
  }
  for (const edge of map.edges) {
    if (!provinceIds.has(edge.a) || !provinceIds.has(edge.b)) {
      throw new Error(`Edge ${edge.a}-${edge.b} references an unknown province`);
    }
    if (edge.split !== undefined && !(edge.split >= 0 && edge.split <= 1)) {
      throw new Error(`Edge ${edge.a}-${edge.b} must have a split between 0 and 1`);
    }
    if (edge.distance <= 0) {
      throw new Error(`Edge ${edge.a}-${edge.b} must have a positive distance`);
    }
  }
  const seaIds = new Set(map.provinces.filter(isSeaProvince).map((p) => p.id));
  for (const [provinceId, ownerId] of Object.entries(setup.owners)) {
    if (!provinceIds.has(provinceId)) throw new Error(`Unknown province in owners: ${provinceId}`);
    if (seaIds.has(provinceId)) throw new Error(`Sea province ${provinceId} cannot have an owner`);
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
    const parts = splitByDomain(rules, army.units);
    if (hasAirUnits(rules, army.units) && (Object.keys(parts.land).length > 0 || Object.keys(parts.sea).length > 0)) {
      throw new Error(`Army ${army.id} mixes aircraft with other units`);
    }
    if (armyKind(rules, army.units) === 'air') {
      const based = (setup.buildings ?? []).some(
        (b) => b.provinceId === army.location && rules.buildings[b.type]?.airbase === true,
      );
      if (!based) throw new Error(`Army ${army.id} has aircraft outside an airbase`);
    } else if (seaIds.has(army.location)) {
      if (!hasNavalUnits(rules, army.units)) throw new Error(`Army ${army.id} has no ships but starts at sea`);
      if (!cargoFits(rules, army.units)) throw new Error(`Army ${army.id} carries more troops than its ships can hold`);
    } else if (hasNavalUnits(rules, army.units)) {
      const docked = (setup.buildings ?? []).some(
        (b) => b.provinceId === army.location && rules.buildings[b.type]?.harbor === true,
      );
      if (!docked) throw new Error(`Army ${army.id} has ships on land without a harbor`);
    }
    return { ...army, units: { ...army.units }, order: null };
  });

  const startingBuildings = new Map<ProvinceId, BuildingId[]>();
  const startingLevels = new Map<ProvinceId, Record<BuildingId, number>>();
  for (const building of setup.buildings ?? []) {
    if (!provinceIds.has(building.provinceId)) {
      throw new Error(`Building ${building.type} is placed in unknown province: ${building.provinceId}`);
    }
    if (!rules.buildings[building.type]) throw new Error(`Unknown building type: ${building.type}`);
    if (seaIds.has(building.provinceId)) throw new Error(`Building ${building.type} cannot stand at sea`);
    const list = startingBuildings.get(building.provinceId) ?? [];
    if (list.includes(building.type)) {
      throw new Error(`Duplicate ${building.type} in province ${building.provinceId}`);
    }
    list.push(building.type);
    startingBuildings.set(building.provinceId, list);
    const level = building.level ?? 1;
    if (!Number.isInteger(level) || level < 1 || level > maxBuildingLevel(rules.buildings[building.type] as BuildingDef)) {
      throw new Error(`Building ${building.type} cannot start at level ${level}`);
    }
    if (level > 1) startingLevels.set(building.provinceId, { ...startingLevels.get(building.provinceId), [building.type]: level });
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
      ...(startingLevels.has(p.id) ? { buildingLevels: { ...startingLevels.get(p.id) } } : {}),
      morale: rules.morale.start,
    })),
    edges: map.edges.map((e) => ({ ...e })),
    armies,
    recruitQueue: [],
    constructionQueue: [],
    relations,
    proposals: [],
    spies: [],
    market: [],
    trades: [],
    chats: [],
    nextId: 1,
    eliminated: [],
    outcome: null,
    events: [],
  };
}

/** Generates an army id that does not collide with existing ones. Advances `state.nextId`. */
export function freshArmyId(state: GameState): ArmyId {
  for (;;) {
    const candidate = `army-${state.nextId}`;
    state.nextId += 1;
    if (!state.armies.some((a) => a.id === candidate)) return candidate;
  }
}
