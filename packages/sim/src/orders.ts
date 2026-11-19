import { findPath } from './pathfinding';
import type { ArmyId, GameState, PlayerId, ProvinceId, Ruleset, UnitTypeId } from './types';

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
  | 'unknown_unit_type'
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

  const def = rules.units[unitType];
  if (!def) return { ok: false, error: 'unknown_unit_type' };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, error: 'invalid_count' };

  if (state.armies.some((a) => a.location === provinceId && a.owner !== playerId)) {
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
    ticksLeft: def.trainingTicks,
  });
  next.nextId += 1;
  return { ok: true, state: next };
}
