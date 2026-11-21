import { effectiveTrainingTicks } from './buildings';
import { areHostile } from './diplomacy';
import { canRecruitAt } from './morale';
import { findPath } from './pathfinding';
import type { ArmyId, BuildingId, GameState, PlayerId, ProvinceId, Ruleset, UnitTypeId } from './types';

export type OrderError =
  | 'game_over'
  | 'army_not_found'
  | 'not_owner'
  | 'province_not_found'
  | 'already_there'
  | 'no_path';

export type OrderResult =
  | { ok: true; state: GameState }
  | { ok: false; error: OrderError };

/**
 * Orders an army to move to a target province along the shortest path.
 * Pure function: the input state is never modified.
 */
export function orderMove(
  state: GameState,
  playerId: PlayerId,
  armyId: ArmyId,
  target: ProvinceId,
): OrderResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return { ok: false, error: 'army_not_found' };
  if (army.owner !== playerId) return { ok: false, error: 'not_owner' };
  if (!state.provinces.some((p) => p.id === target)) return { ok: false, error: 'province_not_found' };
  if (army.location === target) return { ok: false, error: 'already_there' };

  const route = findPath(state.edges, army.location, target);
  if (!route) return { ok: false, error: 'no_path' };

  const next = structuredClone(state);
  const nextArmy = next.armies.find((a) => a.id === armyId);
  if (!nextArmy) return { ok: false, error: 'army_not_found' };
  nextArmy.order = { path: route.path, progress: 0 };
  return { ok: true, state: next };
}

export type RecruitError =
  | 'game_over'
  | 'player_not_found'
  | 'province_not_found'
  | 'not_owner'
  | 'low_morale'
  | 'unknown_unit_type'
  | 'missing_building'
  | 'invalid_count'
  | 'enemy_present'
  | 'insufficient_resources';

export type RecruitResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RecruitError };

/**
 * Orders a batch of units to be trained in a province owned by the player.
 * The full cost is paid immediately; the batch appears as an army when the
 * training time has elapsed. Pure function: the input state is never modified.
 */
export function orderRecruit(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  provinceId: ProvinceId,
  unitType: UnitTypeId,
  count: number,
): RecruitResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'player_not_found' };

  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, error: 'province_not_found' };
  if (province.owner !== playerId) return { ok: false, error: 'not_owner' };
  if (!canRecruitAt(rules, province)) return { ok: false, error: 'low_morale' };

  const def = rules.units[unitType];
  if (!def) return { ok: false, error: 'unknown_unit_type' };
  if (def.requires !== undefined && !province.buildings.includes(def.requires)) {
    return { ok: false, error: 'missing_building' };
  }
  if (!Number.isInteger(count) || count <= 0) return { ok: false, error: 'invalid_count' };

  if (state.armies.some((a) => a.location === provinceId && areHostile(state, playerId, a.owner))) {
    return { ok: false, error: 'enemy_present' };
  }

  for (const [resource, perUnit] of Object.entries(def.cost)) {
    if ((player.stockpile[resource] ?? 0) < perUnit * count) {
      return { ok: false, error: 'insufficient_resources' };
    }
  }

  const next = structuredClone(state);
  const nextPlayer = next.players.find((p) => p.id === playerId);
  if (!nextPlayer) return { ok: false, error: 'player_not_found' };

  for (const [resource, perUnit] of Object.entries(def.cost)) {
    nextPlayer.stockpile[resource] = (nextPlayer.stockpile[resource] ?? 0) - perUnit * count;
  }
  next.recruitQueue.push({
    id: `job-${next.nextId}`,
    owner: playerId,
    provinceId,
    unitType,
    count,
    // Barracks and similar buildings shorten the training time.
    ticksLeft: effectiveTrainingTicks(rules, province, unitType),
  });
  next.nextId += 1;
  return { ok: true, state: next };
}

export type BuildError =
  | 'game_over'
  | 'player_not_found'
  | 'province_not_found'
  | 'not_owner'
  | 'unknown_building'
  | 'already_built'
  | 'already_building'
  | 'enemy_present'
  | 'insufficient_resources';

export type BuildResult =
  | { ok: true; state: GameState }
  | { ok: false; error: BuildError };

/**
 * Orders the construction of a building in a province owned by the player.
 * The full cost is paid immediately. A province holds at most one building of each
 * type, and only one construction of a type at a time.
 * Pure function: the input state is never modified.
 */
export function orderBuild(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  provinceId: ProvinceId,
  buildingType: BuildingId,
): BuildResult {
  if (state.outcome) return { ok: false, error: 'game_over' };

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'player_not_found' };

  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, error: 'province_not_found' };
  if (province.owner !== playerId) return { ok: false, error: 'not_owner' };

  const def = rules.buildings[buildingType];
  if (!def) return { ok: false, error: 'unknown_building' };
  if (province.buildings.includes(buildingType)) return { ok: false, error: 'already_built' };
  if (state.constructionQueue.some((j) => j.provinceId === provinceId && j.buildingType === buildingType)) {
    return { ok: false, error: 'already_building' };
  }
  if (state.armies.some((a) => a.location === provinceId && areHostile(state, playerId, a.owner))) {
    return { ok: false, error: 'enemy_present' };
  }

  for (const [resource, amount] of Object.entries(def.cost)) {
    if ((player.stockpile[resource] ?? 0) < amount) return { ok: false, error: 'insufficient_resources' };
  }

  const next = structuredClone(state);
  const nextPlayer = next.players.find((p) => p.id === playerId);
  if (!nextPlayer) return { ok: false, error: 'player_not_found' };

  for (const [resource, amount] of Object.entries(def.cost)) {
    nextPlayer.stockpile[resource] = (nextPlayer.stockpile[resource] ?? 0) - amount;
  }
  next.constructionQueue.push({
    id: `build-${next.nextId}`,
    owner: playerId,
    provinceId,
    buildingType,
    ticksLeft: def.buildTicks,
  });
  next.nextId += 1;
  return { ok: true, state: next };
}

export type StopError = 'game_over' | 'army_not_found' | 'not_owner';

export type StopResult =
  | { ok: true; state: GameState }
  | { ok: false; error: StopError };

/**
 * Cancels the movement order of an army. The army stays in the last province it reached;
 * progress made on the way to the next one is lost.
 * Pure function: the input state is never modified.
 */
export function orderStop(state: GameState, playerId: PlayerId, armyId: ArmyId): StopResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return { ok: false, error: 'army_not_found' };
  if (army.owner !== playerId) return { ok: false, error: 'not_owner' };

  const next = structuredClone(state);
  const nextArmy = next.armies.find((a) => a.id === armyId);
  if (!nextArmy) return { ok: false, error: 'army_not_found' };
  nextArmy.order = null;
  return { ok: true, state: next };
}
