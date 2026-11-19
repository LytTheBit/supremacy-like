import { totalCount } from './combat';
import type {
  Army,
  ArmyId,
  GameState,
  MapDef,
  PlayerId,
  ProvinceId,
  Ruleset,
  Units,
} from './types';

export interface GameSetup {
  map: MapDef;
  rules: Ruleset;
  players: { id: PlayerId; name: string }[];
  /** Initial owners. Provinces not listed start neutral. */
  owners: Record<ProvinceId, PlayerId>;
  armies: { id: ArmyId; owner: PlayerId; location: ProvinceId; units: Units }[];
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
  if (!(rules.victory.provinceShare > 0.5 && rules.victory.provinceShare <= 1)) {
    throw new Error('victory.provinceShare must be in (0.5, 1]');
  }
  for (const [type, def] of Object.entries(rules.units)) {
    for (const resource of Object.keys(def.cost)) {
      if (!rules.resources.includes(resource)) {
        throw new Error(`Unit ${type} costs unknown resource: ${resource}`);
      }
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

  const emptyStockpile = Object.fromEntries(rules.resources.map((r) => [r, 0]));

  return {
    tick: 0,
    players: setup.players.map((p) => ({ id: p.id, name: p.name, stockpile: { ...emptyStockpile } })),
    provinces: map.provinces.map((p) => ({ ...p, owner: setup.owners[p.id] ?? null })),
    edges: map.edges.map((e) => ({ ...e })),
    armies,
    recruitQueue: [],
    nextId: 1,
    eliminated: [],
    outcome: null,
    events: [],
  };
}
