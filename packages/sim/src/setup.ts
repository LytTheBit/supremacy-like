import { provinceAnchors } from './hexmap/graph';
import { hexToPixel } from './hexmap/hex';
import type { HexMapData } from './hexmap/types';
import { findPath } from './pathfinding';
import { isSeaProvince, landStepRule } from './naval';
import type {
  BuildingId,
  GameState,
  MapDef,
  PlayerId,
  ProvinceId,
  ResourceId,
  Ruleset,
  Units,
} from './types';
import { createGame } from './world';

export interface SkirmishOptions {
  players: { id: PlayerId; name: string }[];
  /** Provinces each player starts with (the capital included). Default 3. */
  provincesPerPlayer?: number;
  /** Troops placed in each capital. Default 10 infantry. */
  startingTroops?: Units;
  /** Starting resources of every player. Default 15000 of each resource of the ruleset. */
  startingStock?: Record<ResourceId, number>;
  /** Buildings that already stand in each capital, on top of `rules.startingBuildings` (which every starting province has). */
  startingBuildings?: BuildingId[];
}

/**
 * A ready-to-play game on a generated map: capitals as far apart as possible,
 * each player gets the provinces closest to their capital, plus troops and resources.
 * Deterministic: the same inputs always give the same game.
 */
export function createSkirmish(
  hexMap: HexMapData,
  mapDef: MapDef,
  rules: Ruleset,
  options: SkirmishOptions,
): GameState {
  const perPlayer = Math.max(1, Math.floor(options.provincesPerPlayer ?? 3));
  const { players } = options;
  if (players.length < 2) throw new Error('A skirmish needs at least two players');
  // Only land provinces can be owned. Sea provinces are left to the ships.
  const landDefs = mapDef.provinces.filter((p) => !isSeaProvince(p));
  if (landDefs.length < players.length * perPlayer) {
    throw new Error(
      `Not enough provinces: ${players.length} players need ${players.length * perPlayer}, the map has ${landDefs.length}`,
    );
  }

  // Players start on the same piece of land when one is big enough, so that troops can reach
  // each other without ships. Otherwise any land province will do.
  const walk = landStepRule(mapDef.provinces);
  const landGroups = groupsOnLand(mapDef, landDefs.map((p) => p.id), walk);
  const biggest = landGroups[0] ?? [];
  const sameLand = biggest.length >= players.length * perPlayer;
  const startPool = sameLand ? new Set(biggest) : new Set(landDefs.map((p) => p.id));

  // Travel distance between provinces (unreachable pairs count as very far).
  const cache = new Map<string, number>();
  const distance = (a: ProvinceId, b: ProvinceId): number => {
    if (a === b) return 0;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let value = cache.get(key);
    if (value === undefined) {
      value = findPath(mapDef.edges, a, b, sameLand ? walk : undefined)?.distance ?? 1e9;
      cache.set(key, value);
    }
    return value;
  };

  // Capitals: the westernmost province first, then always the one farthest from all chosen ones.
  const anchors = provinceAnchors(hexMap);
  const ids = mapDef.provinces.map((p) => p.id).filter((id) => startPool.has(id)).sort();
  const westX = (id: ProvinceId) => {
    const anchor = anchors.get(id);
    return anchor ? hexToPixel(anchor, 1).x : 0;
  };
  const first = [...ids].sort((x, y) => westX(x) - westX(y) || x.localeCompare(y))[0];
  if (first === undefined) throw new Error('The map has no provinces');

  const capitals: ProvinceId[] = [first];
  while (capitals.length < players.length) {
    let best: { id: ProvinceId; score: number } | null = null;
    for (const id of ids) {
      if (capitals.includes(id)) continue;
      const score = Math.min(...capitals.map((c) => distance(id, c)));
      if (!best || score > best.score) best = { id, score };
    }
    if (!best) break;
    capitals.push(best.id);
  }

  // Everyone takes the nearest free province in turns, so the split stays fair.
  const owners: Record<ProvinceId, PlayerId> = {};
  players.forEach((player, i) => {
    const capital = capitals[i];
    if (capital !== undefined) owners[capital] = player.id;
  });
  for (let round = 1; round < perPlayer; round++) {
    players.forEach((player, i) => {
      const capital = capitals[i];
      if (capital === undefined) return;
      const next = ids
        .filter((id) => owners[id] === undefined)
        .sort((x, y) => distance(x, capital) - distance(y, capital) || x.localeCompare(y))[0];
      if (next !== undefined) owners[next] = player.id;
    });
  }

  const troops = options.startingTroops ?? { infantry: 10 };
  const stock = options.startingStock ?? Object.fromEntries(rules.resources.map((r) => [r, 15000]));

  return createGame({
    map: mapDef,
    rules,
    players,
    owners,
    armies: players.flatMap((player, i) => {
      const capital = capitals[i];
      return capital === undefined
        ? []
        : [{ id: `${player.id}-1`, owner: player.id, location: capital, units: { ...troops } }];
    }),
    // The ruleset's starting buildings stand in every starting province, the options' ones in the capital.
    buildings: Object.entries(owners).flatMap(([provinceId, owner]) => {
      const index = players.findIndex((p) => p.id === owner);
      const types = new Set<BuildingId>(rules.startingBuildings ?? []);
      if (capitals[index] === provinceId) for (const type of options.startingBuildings ?? []) types.add(type);
      return [...types].map((type) => ({ provinceId, type }));
    }),
    stockpiles: Object.fromEntries(players.map((p) => [p.id, { ...stock }])),
  });
}

/** Groups of land provinces connected by land, biggest first. */
function groupsOnLand(
  mapDef: MapDef,
  landIds: ProvinceId[],
  walk: (from: ProvinceId, to: ProvinceId) => boolean,
): ProvinceId[][] {
  const land = new Set(landIds);
  const seen = new Set<ProvinceId>();
  const groups: ProvinceId[][] = [];
  for (const start of [...landIds].sort()) {
    if (seen.has(start)) continue;
    const group: ProvinceId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      group.push(current);
      for (const edge of mapDef.edges) {
        const other = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
        if (other === null || seen.has(other) || !land.has(other) || !walk(current, other)) continue;
        seen.add(other);
        stack.push(other);
      }
    }
    groups.push(group.sort());
  }
  return groups.sort((x, y) => y.length - x.length || (x[0] ?? '').localeCompare(y[0] ?? ''));
}
