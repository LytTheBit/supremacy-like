import { previewBattle, sumUnits, totalCount } from './combat';
import { areHostile, hasPendingProposal, orderPropose, orderRespond, proposalsFor, relationBetween } from './diplomacy';
import { canRecruitAt } from './morale';
import { orderBuild, orderMove, orderRecruit } from './orders';
import { findPath } from './pathfinding';
import type {
  Army,
  BuildingId,
  GameState,
  PlayerId,
  Province,
  ProvinceId,
  ResourceId,
  Ruleset,
  UnitDef,
} from './types';

/**
 * A simple rule-based AI. It plays through the same validated orders as a human
 * (orderRecruit / orderMove), so it can never cheat the rules. It sees the whole
 * map (no fog of war yet).
 *
 * Each turn it:
 *   0. answers diplomacy: accepts a truce from a stronger player, accepts an alliance when
 *      both fight a common enemy, rejects the rest; every `diplomacyInterval` ticks it asks
 *      for a truce from a player much stronger than itself, and offers an alliance to a
 *      truce partner that shares an enemy. It never declares war and never attacks a player
 *      it is not at war with;
 *   1. builds (at most one building): first a building that speeds up training, then
 *      the buildings that units require, then economy buildings in its most
 *      productive provinces. Types are found from the ruleset data, not by name;
 *   2. recruits: artillery first (small batch), then commanders (when the ruleset has them
 *      and there are enough troops), then infantry with what is left, in the owned
 *      province closest to the front that has the needed building and enough morale;
 *   3. moves: every idle army of enough size attacks the closest province it can
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
  /** Most provinces that get an economy building (e.g. a workshop). */
  maxEconomyBuildings: number;
  /** Most commanders of one type trained per turn (only when the ruleset has commanders). */
  maxCommanderBatch: number;
  /** A truce offered by a player is accepted if our strength is below their strength times this. */
  truceAcceptRatio: number;
  /** We ask an enemy for a truce when our strength is below their strength times this. */
  truceAskRatio: number;
  /** The AI starts diplomacy every N ticks (it still answers offers every turn). */
  diplomacyInterval: number;
}

export const defaultAiOptions: AiOptions = {
  minHpLeft: 0.3,
  maxInfantryBatch: 10,
  maxArtilleryBatch: 2,
  minAttackUnits: 8,
  maxEconomyBuildings: 3,
  maxCommanderBatch: 1,
  truceAcceptRatio: 1,
  truceAskRatio: 0.6,
  diplomacyInterval: 10,
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

  let current = diplomacyPhase(state, rules, playerId, opts);
  current = buildPhase(current, rules, playerId, opts);
  current = recruitPhase(current, rules, playerId, opts);
  current = movePhase(current, rules, playerId, opts);
  return current;
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

/** Troops a player has in the field, the AI's measure of how strong somebody is. */
function strength(state: GameState, playerId: PlayerId): number {
  return state.armies.filter((a) => a.owner === playerId).reduce((sum, a) => sum + totalCount(a.units), 0);
}

/** Players still in the game, other than the given one. */
function otherPlayers(state: GameState, playerId: PlayerId): PlayerId[] {
  return state.players
    .map((p) => p.id)
    .filter((id) => id !== playerId && !state.eliminated.includes(id))
    .sort();
}

/** True when a third player is at war with both of us. */
function haveCommonEnemy(state: GameState, a: PlayerId, b: PlayerId): boolean {
  return state.players.some(
    (p) => p.id !== a && p.id !== b && !state.eliminated.includes(p.id) && areHostile(state, a, p.id) && areHostile(state, b, p.id),
  );
}

function diplomacyPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  let current = state;

  // 1. Answer every offer made to us.
  for (const proposal of proposalsFor(state, playerId)) {
    const mine = strength(current, playerId);
    const theirs = strength(current, proposal.from);
    const accept =
      proposal.kind === 'truce'
        ? mine < theirs * opts.truceAcceptRatio
        : haveCommonEnemy(current, playerId, proposal.from);
    const result = orderRespond(current, rules, playerId, proposal.id, accept);
    if (result.ok) current = result.state;
  }

  // 2. Now and then, reach out.
  if (current.tick % Math.max(1, opts.diplomacyInterval) !== 0) return current;

  for (const other of otherPlayers(current, playerId)) {
    const status = relationBetween(current, playerId, other);
    if (status === 'war') {
      const mine = strength(current, playerId);
      const theirs = strength(current, other);
      // Weak against this enemy: ask for peace. A player with no troops at all is not asked.
      if (theirs > 0 && mine < theirs * opts.truceAskRatio && !hasPendingProposal(current, playerId, other, 'truce')) {
        const result = orderPropose(current, rules, playerId, other, 'truce');
        if (result.ok) current = result.state;
      }
    } else if (status === 'truce' && haveCommonEnemy(current, playerId, other)) {
      if (!hasPendingProposal(current, playerId, other, 'alliance')) {
        const result = orderPropose(current, rules, playerId, other, 'alliance');
        if (result.ok) current = result.state;
      }
    }
  }
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

/**
 * The owned, enemy-free province closest to any province the player does not own.
 * `accept` can restrict the candidates (for example to provinces with a given building).
 */
function stagingProvince(
  state: GameState,
  playerId: PlayerId,
  accept: (province: Province) => boolean = () => true,
): ProvinceId | null {
  const owned = state.provinces.filter((p) => p.owner === playerId);
  const targets = state.provinces.filter((p) => isTarget(state, playerId, p));
  let best: { id: ProvinceId; distance: number } | null = null;

  for (const province of [...owned].sort((x, y) => x.id.localeCompare(y.id))) {
    if (hostileAt(state, playerId, province.id) || !accept(province)) continue;
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
  let current = state;
  const plan: [string, number][] = [
    ['artillery', opts.maxArtilleryBatch],
    ...commanderPlan(state, rules, playerId, opts),
    ['infantry', opts.maxInfantryBatch],
  ];

  for (const [unitType, cap] of plan) {
    const def = rules.units[unitType];
    const player = current.players.find((p) => p.id === playerId);
    if (!def || !player) continue;

    // Train where the required building stands, as close to the front as possible.
    const required = def.requires;
    const staging = stagingProvince(
      current,
      playerId,
      (province) =>
        canRecruitAt(rules, province) && (required === undefined || province.buildings.includes(required)),
    );
    if (!staging) continue;

    const count = Math.min(cap, maxAffordable(def, player.stockpile));
    if (count <= 0) continue;

    const result = orderRecruit(current, rules, playerId, staging, unitType, count);
    if (result.ok) current = result.state;
  }
  return current;
}

/**
 * Commanders worth training: only once the player has a real army, strongest type first,
 * and never more than needed to reach each type's maximum bonus.
 */
function commanderPlan(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  opts: AiOptions,
): [string, number][] {
  const mine = state.armies.filter((a) => a.owner === playerId);
  let troops = 0;
  for (const army of mine) {
    for (const [type, count] of Object.entries(army.units)) {
      if (!rules.units[type]?.commander) troops += count;
    }
  }
  if (troops < opts.minAttackUnits) return [];

  const plan: [string, number][] = [];
  const types = Object.entries(rules.units)
    .filter(([, def]) => def.commander !== undefined)
    .sort((x, y) => (y[1].commander?.bonus ?? 0) - (x[1].commander?.bonus ?? 0) || x[0].localeCompare(y[0]));

  for (const [type, def] of types) {
    const commander = def.commander;
    if (!commander || commander.bonus <= 0) continue;
    const have =
      mine.reduce((sum, a) => sum + (a.units[type] ?? 0), 0) +
      state.recruitQueue
        .filter((j) => j.owner === playerId && j.unitType === type)
        .reduce((sum, j) => sum + j.count, 0);
    const needed = Math.ceil(commander.maxBonus / commander.bonus - 1e-9) - Math.floor(have);
    const cap = Math.min(opts.maxCommanderBatch, needed);
    if (cap > 0) plan.push([type, cap]);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function buildPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  const owned = state.provinces.filter((p) => p.owner === playerId);
  const queued = state.constructionQueue.filter((j) => j.owner === playerId);
  const hasOrBuilding = (type: BuildingId) =>
    owned.some((p) => p.buildings.includes(type)) || queued.some((j) => j.buildingType === type);

  const entries = Object.entries(rules.buildings);
  const required = new Set(
    Object.values(rules.units)
      .map((u) => u.requires)
      .filter((r): r is BuildingId => r !== undefined),
  );
  const boosters = entries.filter(([, def]) => (def.trainingTimeMultiplier ?? 1) < 1).map(([id]) => id);
  const enablers = entries.filter(([id]) => required.has(id)).map(([id]) => id);
  const economy = entries.filter(([, def]) => (def.productionMultiplier ?? 1) > 1).map(([id]) => id);

  const front = stagingProvince(state, playerId);
  const wanted: { type: BuildingId; province: ProvinceId | null }[] = [];

  // One of each training booster and unit-enabling building, near the front.
  for (const type of [...boosters, ...enablers]) {
    if (!hasOrBuilding(type)) wanted.push({ type, province: front });
  }

  // Economy buildings in the most productive provinces, up to a limit.
  for (const type of economy) {
    const count =
      owned.filter((p) => p.buildings.includes(type)).length + queued.filter((j) => j.buildingType === type).length;
    if (count >= opts.maxEconomyBuildings) continue;
    const best = owned
      .filter(
        (p) =>
          !p.buildings.includes(type) &&
          !queued.some((j) => j.provinceId === p.id && j.buildingType === type) &&
          !hostileAt(state, playerId, p.id),
      )
      .sort((x, y) => y.production - x.production || x.id.localeCompare(y.id))[0];
    wanted.push({ type, province: best?.id ?? null });
  }

  // At most one new construction per turn: the first one that can be paid.
  for (const item of wanted) {
    if (item.province === null) continue;
    const result = orderBuild(state, rules, playerId, item.province, item.type);
    if (result.ok) return result.state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Movement and attacks
// ---------------------------------------------------------------------------

function hostileAt(state: GameState, playerId: PlayerId, provinceId: ProvinceId): boolean {
  return state.armies.some((a) => a.location === provinceId && areHostile(state, playerId, a.owner));
}

/** A province the player may attack: neutral, or owned by someone at war with the player. */
function isTarget(state: GameState, playerId: PlayerId, province: Province): boolean {
  return province.owner === null || (province.owner !== playerId && areHostile(state, playerId, province.owner));
}

/** True if the army would beat whatever enemy force stands in the province. */
function canHold(
  state: GameState,
  rules: Ruleset,
  army: Army,
  provinceId: ProvinceId,
  opts: AiOptions,
): boolean {
  const defenders = state.armies.filter((a) => a.location === provinceId && areHostile(state, army.owner, a.owner));
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

    // Production is compared to the best province of the map, so the AI does not
    // depend on the resource scale of the ruleset.
    const topProduction = Math.max(1, ...current.provinces.map((p) => p.production));

    let best: { id: ProvinceId; score: number } | null = null;
    for (const target of current.provinces) {
      if (!isTarget(current, playerId, target)) continue;

      const route = findPath(current.edges, army.location, target.id);
      if (!route) continue;

      // Every province on the way (and the target) must be winnable, because the
      // army stops and fights as soon as it meets an enemy.
      if (!route.path.every((id) => canHold(current, rules, army, id, opts))) continue;

      // Prefer close targets, enemy-owned ones, and productive ones.
      const score = route.distance - (target.owner !== null ? 1 : 0) - (target.production / topProduction) * 0.3;
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
