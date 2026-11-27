import { areAllied } from './diplomacy';
import type { Province, GameState, PlayerId, ProvinceId, Ruleset, Terrain, UnitDomain, Units } from './types';
import type { Army } from './types';
import { buildAdjacency, findPath, type PathResult } from './pathfinding';

/**
 * Sea provinces, ships and amphibious operations.
 *
 * - Sea provinces (`terrain: 'sea'`) are never owned and never produce anything. Only armies
 *   with sea units can enter them.
 * - Sea units (`UnitDef.domain === 'sea'`) are trained in a port, sail through sea provinces
 *   and may dock in a province that has a harbor building owned by their owner or an ally.
 * - Land units cross the sea as cargo: an army that mixes ships and land units can sail as long
 *   as the ships' total `capacity` covers all the land units. Cargo does not fight at sea.
 * - Landing: a fleet carrying land units may enter any coastal land province as the LAST step
 *   of its route. The land units get off, the ships stay in the sea province they came from.
 * - Inside a port the army stays whole (docked) until it is split with orderDisembark().
 * - Air units fly over land and sea but never farther than their `range` from an airbase of
 *   their owner or an ally. After a raid an idle air army flies back to the nearest base on
 *   its own (see tick.ts).
 */

/** Unit counts at or below this are treated as "not there" (casualties leave fractions). */
export const PRESENT = 0.001;

export function terrainOf(province: { terrain?: Terrain }): Terrain {
  return province.terrain ?? 'land';
}

export function isSeaProvince(province: { terrain?: Terrain }): boolean {
  return terrainOf(province) === 'sea';
}

export function unitDomain(rules: Ruleset, type: string): UnitDomain {
  return rules.units[type]?.domain ?? 'land';
}

/** Splits a unit set by domain. Units that are (almost) gone are dropped. */
export function splitByDomain(rules: Ruleset, units: Units): { land: Units; sea: Units; air: Units } {
  const parts = { land: {} as Units, sea: {} as Units, air: {} as Units };
  for (const [type, count] of Object.entries(units)) {
    if (count <= PRESENT) continue;
    if (!rules.units[type]) throw new Error(`Unknown unit type: ${type}`);
    parts[unitDomain(rules, type)][type] = count;
  }
  return parts;
}

export function hasAirUnits(rules: Ruleset, units: Units): boolean {
  return Object.keys(splitByDomain(rules, units).air).length > 0;
}

/** The three kinds of army. Armies of different kinds never merge by themselves. */
export type ArmyKind = 'land' | 'sea' | 'air';

export function armyKind(rules: Ruleset, units: Units): ArmyKind {
  const { sea, air } = splitByDomain(rules, units);
  if (Object.keys(air).length > 0) return 'air';
  return Object.keys(sea).length > 0 ? 'sea' : 'land';
}

/** How far an air army can fly from its base: the shortest range among its aircraft. */
export function airRange(rules: Ruleset, units: Units): number {
  let range = Infinity;
  for (const type of Object.keys(splitByDomain(rules, units).air)) {
    range = Math.min(range, rules.units[type]?.range ?? 0);
  }
  return Number.isFinite(range) ? range : 0;
}

/** Number of land units (commanders included). */
export function landTroops(rules: Ruleset, units: Units): number {
  return Object.values(splitByDomain(rules, units).land).reduce((sum, n) => sum + n, 0);
}

export function hasNavalUnits(rules: Ruleset, units: Units): boolean {
  return Object.keys(splitByDomain(rules, units).sea).length > 0;
}

export function hasLandUnits(rules: Ruleset, units: Units): boolean {
  return Object.keys(splitByDomain(rules, units).land).length > 0;
}

/** How many land units the ships of this army can carry. */
export function cargoCapacity(rules: Ruleset, units: Units): number {
  let capacity = 0;
  for (const [type, count] of Object.entries(splitByDomain(rules, units).sea)) {
    capacity += (rules.units[type]?.capacity ?? 0) * count;
  }
  return capacity;
}

/** True when the ships of the army can carry all of its land units (always true with no cargo). */
export function cargoFits(rules: Ruleset, units: Units): boolean {
  return landTroops(rules, units) <= cargoCapacity(rules, units) + 1e-9;
}

/**
 * The units that actually fight in a province. At sea, land units are cargo: they do not
 * attack, defend or add hit points (they still die with the ships, see resolveCombat()).
 * Aircraft fight anywhere.
 */
export function combatUnits(rules: Ruleset, units: Units, atSea: boolean): Units {
  if (!atSea) return units;
  const { sea, air } = splitByDomain(rules, units);
  return { ...sea, ...air };
}

/** A land province that touches at least one sea province. */
export function isCoastal(state: Pick<GameState, 'provinces' | 'edges'>, provinceId: ProvinceId): boolean {
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province || isSeaProvince(province)) return false;
  const sea = new Set(state.provinces.filter(isSeaProvince).map((p) => p.id));
  return state.edges.some(
    (e) => (e.a === provinceId && sea.has(e.b)) || (e.b === provinceId && sea.has(e.a)),
  );
}

/** True when ships of `owner` can dock in this province: a harbor owned by them or an ally. */
export function canDockAt(state: GameState, rules: Ruleset, owner: PlayerId, province: Province): boolean {
  if (isSeaProvince(province) || province.owner === null) return false;
  if (province.owner !== owner && !areAllied(state, owner, province.owner)) return false;
  return province.buildings.some((id) => rules.buildings[id]?.harbor === true);
}

/** True when aircraft of `owner` can be based in this province: an airbase of theirs or an ally's. */
export function hasAirbaseAccess(state: GameState, rules: Ruleset, owner: PlayerId, province: Province): boolean {
  if (isSeaProvince(province) || province.owner === null) return false;
  if (province.owner !== owner && !areAllied(state, owner, province.owner)) return false;
  return province.buildings.some((id) => rules.buildings[id]?.airbase === true);
}

/** True when `owner` can use the railways of this province: its own, or an ally's. */
export function hasRailAccess(state: GameState, rules: Ruleset, owner: PlayerId, province: Province): boolean {
  if (isSeaProvince(province) || province.owner === null) return false;
  if (province.owner !== owner && !areAllied(state, owner, province.owner)) return false;
  return province.buildings.some((id) => rules.buildings[id]?.railSpeedFactor !== undefined);
}

/**
 * How many times faster troops of `owner` move while they are inside this province: the railway factor
 * of its best railway when the owner can use it (its own or an ally's), else 1.
 */
export function railBonus(state: GameState, rules: Ruleset, owner: PlayerId, province: Province): number {
  if (!hasRailAccess(state, rules, owner, province)) return 1;
  let factor = 1;
  for (const id of province.buildings) factor = Math.max(factor, rules.buildings[id]?.railSpeedFactor ?? 1);
  return factor;
}

/** True when some unit of the set can only travel on railways. */
export function hasRailOnlyUnits(rules: Ruleset, units: Units): boolean {
  return Object.entries(units).some(([type, count]) => count > PRESENT && rules.units[type]?.railOnly === true);
}

/** Provinces where aircraft of `owner` can land, sorted by id. */
export function airbasesOf(state: GameState, rules: Ruleset, owner: PlayerId): ProvinceId[] {
  return state.provinces
    .filter((p) => hasAirbaseAccess(state, rules, owner, p))
    .map((p) => p.id)
    .sort();
}

/** Travel distance from the closest of `sources` to every province (terrain is ignored). */
function distancesFrom(state: GameState, sources: ProvinceId[]): Map<ProvinceId, number> {
  const adjacency = buildAdjacency(state.edges);
  const best = new Map<ProvinceId, number>(sources.map((id) => [id, 0]));
  const open = new Set<ProvinceId>(sources);
  while (open.size > 0) {
    let current: ProvinceId | null = null;
    for (const id of [...open].sort()) {
      if (current === null || (best.get(id) ?? Infinity) < (best.get(current) ?? Infinity)) current = id;
    }
    if (current === null) break;
    open.delete(current);
    const here = best.get(current) ?? 0;
    for (const link of adjacency.get(current) ?? []) {
      const total = here + link.distance;
      if (total < (best.get(link.to) ?? Infinity)) {
        best.set(link.to, total);
        open.add(link.to);
      }
    }
  }
  return best;
}

export type StepRule = (from: ProvinceId, to: ProvinceId) => boolean;

/**
 * Which steps between two adjacent provinces an army may take.
 * - Land armies walk on land only.
 * - Armies with ships sail into sea provinces (if the cargo fits), leave a port to the sea,
 *   dock in a port of their own or an ally, or land troops on any coast. They never travel
 *   over land, and a landing is always the last step of a route.
 */
export function makeStepRule(state: GameState, rules: Ruleset, army: Pick<Army, 'owner' | 'units'>): StepRule {
  const provinces = new Map(state.provinces.map((p) => [p.id, p]));

  // Aircraft go anywhere that is within their range of a friendly airbase.
  if (hasAirUnits(rules, army.units)) {
    const range = airRange(rules, army.units);
    const fromBase = distancesFrom(state, airbasesOf(state, rules, army.owner));
    return (from, to) =>
      provinces.has(from) && provinces.has(to) && (fromBase.get(to) ?? Infinity) <= range + 1e-9;
  }

  const naval = hasNavalUnits(rules, army.units);
  const cargo = landTroops(rules, army.units);
  const fits = cargoFits(rules, army.units);
  const railBound = hasRailOnlyUnits(rules, army.units);

  return (from, to) => {
    const a = provinces.get(from);
    const b = provinces.get(to);
    if (!a || !b) return false;
    const fromSea = isSeaProvince(a);
    const toSea = isSeaProvince(b);

    if (!naval) {
      if (fromSea || toSea) return false;
      // Railway guns only go from one railway to the next.
      return !railBound || (hasRailAccess(state, rules, army.owner, a) && hasRailAccess(state, rules, army.owner, b));
    }

    // Ships only leave a land province from a port (a landing is the end of the route).
    if (!fromSea && !canDockAt(state, rules, army.owner, a)) return false;
    if (toSea) return fits;
    if (!fromSea) return false; // ships never cross land
    return canDockAt(state, rules, army.owner, b) || cargo > PRESENT;
  };
}

/** Shortest route for an army, following the movement rules of its units. Null if unreachable. */
export function findArmyPath(
  state: GameState,
  rules: Ruleset,
  army: Pick<Army, 'owner' | 'units' | 'location'>,
  target: ProvinceId,
): PathResult | null {
  return findPath(state.edges, army.location, target, makeStepRule(state, rules, army));
}

/** Step rule of plain land troops, for code that only has the map (setup, AI). */
export function landStepRule(provinces: { id: ProvinceId; terrain?: Terrain }[]): StepRule {
  const sea = new Set(provinces.filter(isSeaProvince).map((p) => p.id));
  return (from, to) => !sea.has(from) && !sea.has(to);
}
