import { previewBattle, sumUnits, totalCount } from './combat';
import { orderMove, orderRecruit } from './orders';
import { findPath } from './pathfinding';
import type { Army, GameState, PlayerId, ProvinceId, ResourceId, Ruleset, UnitDef } from './types';

/**
 * A simple rule-based AI. It plays through the same validated orders as a human
 * (orderRecruit / orderMove), so it can never cheat the rules. It sees the whole
 * map (no fog of war yet).
 *
 * Each turn it:
 *   1. recruits: artillery first (small batch), then infantry with what is left,
 *      in the owned province closest to the front;
 *   2. moves: every idle army of enough size attacks the closest province it can
 *      take, judged with previewBattle(); smaller armies and armies that cannot
 *      win anywhere wait at home and grow (idle armies merge automatically).
 */

export interface AiOptions {
  /** An attack is accepted only if the attacker keeps at least this share of its strength. */
  minHpLeft: number;
  maxInfantryBatch: number;
  maxArtilleryBatch: number;
  /** Armies smaller than this wait at home and grow instead of attacking piecemeal. */
  minAttackUnits: number;
}

export const defaultAiOptions: AiOptions = {
  minHpLeft: 0.3,
  maxInfantryBatch: 10,
  maxArtilleryBatch: 2,
  minAttackUnits: 8,
};

/** Plays one turn for a player and returns the new state. Pure function. */
export function runAi(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  options: Partial<AiOptions> = {},
): GameState {
  const opts = { ...defaultAiOptions, ...options };
  if (state.outcome || state.eliminated.includes(playerId)) return state;
  if (!state.players.some((p) => p.id === playerId)) return state;

  let current = recruitPhase(state, rules, playerId, opts);
  current = movePhase(current, rules, playerId, opts);
  return current;
}

// ---------------------------------------------------------------------------
// Recruiting
// ---------------------------------------------------------------------------

/** How many units of a type the stockpile can pay for. */
function maxAffordable(def: UnitDef, stockpile: Record<ResourceId, number>): number {
  let affordable = Infinity;
  for (const [resource, perUnit] of Object.entries(def.cost)) {
    if (perUnit <= 0) continue;
    affordable = Math.min(affordable, Math.floor((stockpile[resource] ?? 0) / perUnit));
  }
  return Number.isFinite(affordable) ? affordable : 0;
}

/** The owned, enemy-free province closest to any province the player does not own. */
function stagingProvince(state: GameState, playerId: PlayerId): ProvinceId | null {
  const owned = state.provinces.filter((p) => p.owner === playerId);
  const targets = state.provinces.filter((p) => p.owner !== playerId);
  let best: { id: ProvinceId; distance: number } | null = null;

  for (const province of [...owned].sort((x, y) => x.id.localeCompare(y.id))) {
    if (hostileAt(state, playerId, province.id)) continue;
    let nearest = Infinity;
    for (const target of targets) {
      const route = findPath(state.edges, province.id, target.id);
      if (route) nearest = Math.min(nearest, route.distance);
    }
    if (!best || nearest < best.distance) best = { id: province.id, distance: nearest };
  }
  return best?.id ?? null;
}

function recruitPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  const staging = stagingProvince(state, playerId);
  if (!staging) return state;

  let current = state;
  const plan: [string, number][] = [
    ['artillery', opts.maxArtilleryBatch],
    ['infantry', opts.maxInfantryBatch],
  ];

  for (const [unitType, cap] of plan) {
    const def = rules.units[unitType];
    const player = current.players.find((p) => p.id === playerId);
    if (!def || !player) continue;

    const count = Math.min(cap, maxAffordable(def, player.stockpile));
    if (count <= 0) continue;

    const result = orderRecruit(current, rules, playerId, staging, unitType, count);
    if (result.ok) current = result.state;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Movement and attacks
// ---------------------------------------------------------------------------

function hostileAt(state: GameState, playerId: PlayerId, provinceId: ProvinceId): boolean {
  return state.armies.some((a) => a.location === provinceId && a.owner !== playerId);
}

/** True if the army would beat whatever enemy force stands in the province. */
function canHold(
  state: GameState,
  rules: Ruleset,
  army: Army,
  provinceId: ProvinceId,
  opts: AiOptions,
): boolean {
  const defenders = state.armies.filter((a) => a.location === provinceId && a.owner !== army.owner);
  if (defenders.length === 0) return true;

  const preview = previewBattle(rules, army.units, sumUnits(defenders.map((a) => a.units)));
  return preview.winner === 'attacker' && preview.attackerHpLeft >= opts.minHpLeft;
}

function movePhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  let current = state;
  const mine = state.armies
    .filter((a) => a.owner === playerId)
    .sort((x, y) => x.id.localeCompare(y.id));

  for (const original of mine) {
    // Re-read the army: previous orders in this loop never change other armies, but stay safe.
    const army = current.armies.find((a) => a.id === original.id);
    if (!army || army.order || totalCount(army.units) <= 0) continue;
    if (hostileAt(current, playerId, army.location)) continue; // engaged in a battle
    if (totalCount(army.units) < opts.minAttackUnits) continue; // too small, keep growing

    let best: { id: ProvinceId; score: number } | null = null;
    for (const target of current.provinces) {
      if (target.owner === playerId) continue;

      const route = findPath(current.edges, army.location, target.id);
      if (!route) continue;

      // Every province on the way (and the target) must be winnable, because the
      // army stops and fights as soon as it meets an enemy.
      if (!route.path.every((id) => canHold(current, rules, army, id, opts))) continue;

      // Prefer close targets, enemy-owned ones, and productive ones.
      const score = route.distance - (target.owner !== null ? 1 : 0) - target.production * 0.1;
      if (!best || score < best.score || (score === best.score && target.id < best.id)) {
        best = { id: target.id, score };
      }
    }

    if (best) {
      const result = orderMove(current, playerId, army.id, best.id);
      if (result.ok) current = result.state;
    }
  }
  return current;
}
