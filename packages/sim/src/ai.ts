import { previewBattle, sumUnits, totalCount } from './combat';
import { areHostile, hasPendingProposal, orderPropose, orderRespond, proposalsFor, relationBetween } from './diplomacy';
import { canRecruitAt } from './morale';
import { canSpyOn, isSpyInPlace, orderSpy, orderSpyMission } from './espionage';
import { visibleProvinces } from './visibility';
import { orderBuild, orderEmbark, orderMove, orderRecruit } from './orders';
import { buildAdjacency, findPath } from './pathfinding';
import {
  airbasesOf,
  armyKind,
  canDockAt,
  cargoCapacity,
  combatUnits,
  findArmyPath,
  hasLandUnits,
  hasNavalUnits,
  isCoastal,
  isSeaProvince,
  landStepRule,
  landTroops,
  splitByDomain,
} from './naval';
import type {
  Army,
  BuildingDef,
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
 * (orderRecruit / orderMove), so it can never cheat the rules. It obeys the fog of war:
 * it only knows about enemy armies inside its own vision (and allies'). When it plans an
 * attack through a province it cannot see, it assumes nobody is there.
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
 *   3. moves: every idle land army of enough size attacks the closest province it can
 *      take, judged with previewBattle(); smaller armies and armies that cannot
 *      win anywhere wait at home and grow (idle armies merge automatically);
 *   4. air force: once it has enough provinces it builds an airfield, trains fighters and
 *      bombers and raids visible enemy armies within range of its bases when previewBattle()
 *      says the raid wins; aircraft that are losing a fight fly back to a base;
 *   5. navy: only when no province is left to take by land (and the map has sea provinces).
 *      It builds a port, gathers troops there, trains transports and cruisers, embarks an
 *      army, sails it to a coast it can take and lands it. Ships then return to the port.
 *      Landed troops go on as an ordinary land army.
 *   6. spies: now and then, when it has resources to spare, it sends a spy to the enemy province
 *      closest to its own land (only players it is at war with). A spy in place sabotages the most
 *      expensive building of its province, or else lowers the morale, if the cover lasts long enough
 *      to finish. Against truce partners spies only watch.
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
  /** Use aircraft (airfield, fighters, bombers, raids). */
  airForce: boolean;
  /** Use ships for amphibious attacks when no target is left on land. */
  navy: boolean;
  maxFighterBatch: number;
  maxBomberBatch: number;
  maxTransportBatch: number;
  /** Aircraft armies smaller than this stay on the ground. */
  minAirUnits: number;
  /** The AI builds an airfield only when it owns at least this many provinces. */
  minProvincesForAir: number;
  /** Use spies (needs `rules.espionage`). */
  spies: boolean;
  /** Most spies the AI has at once (also limited by the ruleset). */
  maxSpies: number;
  /** The AI sends a new spy at most every N ticks. */
  spyInterval: number;
  /** A spy is only sent if every resource of its cost stays above this level afterwards. */
  spyReserve: number;
  /** Disinformation is only worth it in provinces with at least this morale. */
  minMoraleToHarm: number;
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
  airForce: true,
  navy: true,
  maxFighterBatch: 1,
  maxBomberBatch: 1,
  maxTransportBatch: 2,
  minAirUnits: 2,
  minProvincesForAir: 4,
  spies: true,
  maxSpies: 2,
  spyInterval: 5,
  spyReserve: 8000,
  minMoraleToHarm: 50,
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
  current = airPhase(current, rules, playerId, opts);
  current = navyPhase(current, rules, playerId, opts);
  current = spyPhase(current, rules, playerId, opts);
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
  const walk = landStepRule(state.provinces);
  let best: { id: ProvinceId; distance: number } | null = null;

  for (const province of [...owned].sort((x, y) => x.id.localeCompare(y.id))) {
    if (hostileAt(state, playerId, province.id) || !accept(province)) continue;
    let nearest = Infinity;
    for (const target of targets) {
      const route = findPath(state.edges, province.id, target.id, walk);
      if (route) nearest = Math.min(nearest, route.distance);
    }
    if (!best || nearest < best.distance) best = { id: province.id, distance: nearest };
  }
  return best?.id ?? null;
}

function recruitPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  let current = state;
  const amphibious = amphibiousMode(state, rules, playerId, opts);
  const army = armyUnitCount(state, rules, playerId);
  const plan: [string, number][] = [
    ...(amphibious ? navyPlan(state, rules, playerId, opts) : []),
    ['artillery', opts.maxArtilleryBatch],
    ...airPlan(state, rules, playerId, opts, army),
    ...commanderPlan(state, rules, playerId, opts),
    ['infantry', opts.maxInfantryBatch],
  ];

  for (const [unitType, cap] of plan) {
    const def = rules.units[unitType];
    const player = current.players.find((p) => p.id === playerId);
    if (!def || !player) continue;
    const domain = def.domain ?? 'land';

    // Train where the required building stands, as close to the front as possible.
    const required = def.requires;
    const accept = (province: Province) =>
      canRecruitAt(rules, province) && (required === undefined || province.buildings.includes(required));
    let staging: ProvinceId | null = null;
    let limit = cap;

    // Preparing a landing: land troops are trained at the port, but only as many as the
    // ships there can carry.
    const port = amphibious && domain === 'land' ? portProvince(current, rules, playerId) : null;
    if (port) {
      staging = stagingProvince(current, playerId, (province) => province.id === port && accept(province));
      limit = Math.min(cap, landingRoom(current, rules, playerId, port));
    }
    staging ??= stagingProvince(current, playerId, accept);
    if (!staging) continue;

    const count = Math.min(limit, maxAffordable(def, player.stockpile));
    if (count <= 0) continue;

    const result = orderRecruit(current, rules, playerId, staging, unitType, count);
    if (result.ok) current = result.state;
  }
  return current;
}

/** Number of non-commander land units the player has in the field. */
function armyUnitCount(state: GameState, rules: Ruleset, playerId: PlayerId): number {
  let troops = 0;
  for (const army of state.armies) {
    if (army.owner !== playerId) continue;
    for (const [type, count] of Object.entries(splitByDomain(rules, army.units).land)) {
      if (!rules.units[type]?.commander) troops += count;
    }
  }
  return troops;
}

/** Fighters and bombers, once there is an airbase and a real army. */
function airPlan(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  opts: AiOptions,
  troops: number,
): [string, number][] {
  if (!opts.airForce || troops < opts.minAttackUnits) return [];
  if (airbasesOf(state, rules, playerId).length === 0) return [];
  const plan: [string, number][] = [];
  const batches: Record<string, number> = { fighter: opts.maxFighterBatch, bomber: opts.maxBomberBatch };
  for (const [type, def] of Object.entries(rules.units).sort((x, y) => x[0].localeCompare(y[0]))) {
    if (def.domain === 'air') plan.push([type, batches[type] ?? 1]);
  }
  return plan;
}

/** Transports until the port fleet can carry a landing force, plus an escort. */
function navyPlan(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): [string, number][] {
  const port = portProvince(state, rules, playerId);
  if (port === null) return [];
  const transport = Object.entries(rules.units).find(([, def]) => def.domain === 'sea' && (def.capacity ?? 0) > 0);
  const warship = Object.entries(rules.units).find(
    ([, def]) => def.domain === 'sea' && (def.capacity ?? 0) === 0 && def.attack > 0,
  );
  const plan: [string, number][] = [];

  if (transport) {
    const [type, def] = transport;
    const wanted = Math.max(opts.minAttackUnits + 4, troopsAt(state, rules, playerId, port));
    const missing = Math.ceil((wanted - portCapacity(state, rules, playerId, port)) / (def.capacity ?? 1) - 1e-9);
    if (missing > 0) plan.push([type, Math.min(opts.maxTransportBatch, missing)]);
  }
  if (warship && transport) {
    const have = shipsAt(state, rules, playerId, warship[0]);
    const transports = shipsAt(state, rules, playerId, transport[0]);
    if (transports > 0 && have < 1 + Math.floor(transports / 2)) plan.push([warship[0], 1]);
  }
  return plan;
}

/** Ships of a type owned by the player, in armies and in the training queue. */
function shipsAt(state: GameState, rules: Ruleset, playerId: PlayerId, unitType: string): number {
  void rules;
  return (
    state.armies.filter((a) => a.owner === playerId).reduce((sum, a) => sum + Math.floor(a.units[unitType] ?? 0), 0) +
    state.recruitQueue.filter((j) => j.owner === playerId && j.unitType === unitType).reduce((sum, j) => sum + j.count, 0)
  );
}

/** Land units at (or being trained for) a province: idle armies, cargo and the training queue. */
function troopsAt(state: GameState, rules: Ruleset, playerId: PlayerId, provinceId: ProvinceId): number {
  let troops = 0;
  for (const army of state.armies) {
    if (army.owner === playerId && army.location === provinceId) troops += landTroops(rules, army.units);
  }
  for (const job of state.recruitQueue) {
    if (job.owner === playerId && job.provinceId === provinceId && (rules.units[job.unitType]?.domain ?? 'land') === 'land') {
      troops += job.count;
    }
  }
  return troops;
}

/** How many land units the ships at (or queued for) a port can carry. */
function portCapacity(state: GameState, rules: Ruleset, playerId: PlayerId, provinceId: ProvinceId): number {
  let capacity = 0;
  for (const army of state.armies) {
    if (army.owner === playerId && army.location === provinceId) capacity += cargoCapacity(rules, army.units);
  }
  for (const job of state.recruitQueue) {
    if (job.owner === playerId && job.provinceId === provinceId) {
      capacity += (rules.units[job.unitType]?.capacity ?? 0) * job.count;
    }
  }
  return capacity;
}

/** How many more land units can still be trained at the port before the ships are full. */
function landingRoom(state: GameState, rules: Ruleset, playerId: PlayerId, port: ProvinceId): number {
  return Math.max(0, Math.floor(portCapacity(state, rules, playerId, port) - troopsAt(state, rules, playerId, port)));
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
  // Buildings that only ships or aircraft need (ports, airfields) are ignored for now.
  const required = new Set(
    Object.values(rules.units)
      .filter((u) => (u.domain ?? 'land') === 'land')
      .map((u) => u.requires)
      .filter((r): r is BuildingId => r !== undefined),
  );
  const requiredBy = (domain: 'sea' | 'air') =>
    new Set(
      Object.values(rules.units)
        .filter((u) => u.domain === domain)
        .map((u) => u.requires)
        .filter((r): r is BuildingId => r !== undefined),
    );
  const boosters = entries.filter(([, def]) => (def.trainingTimeMultiplier ?? 1) < 1).map(([id]) => id);
  const enablers = entries.filter(([id]) => required.has(id)).map(([id]) => id);
  const seaEnablers = entries.filter(([id]) => requiredBy('sea').has(id));
  const airEnablers = entries.filter(([id]) => requiredBy('air').has(id)).map(([id]) => id);
  const economy = entries.filter(([, def]) => (def.productionMultiplier ?? 1) > 1).map(([id]) => id);

  const front = stagingProvince(state, playerId);
  const wanted: { type: BuildingId; province: ProvinceId | null }[] = [];

  // One of each training booster and unit-enabling building, near the front.
  for (const type of [...boosters, ...enablers]) {
    if (!hasOrBuilding(type)) wanted.push({ type, province: front });
  }

  // An airfield once the country is big enough to afford aircraft.
  if (opts.airForce && owned.length >= opts.minProvincesForAir) {
    for (const type of airEnablers) {
      if (!hasOrBuilding(type)) wanted.push({ type, province: front });
    }
  }

  // Nothing left to conquer on foot: a port comes first (ports need a coast).
  if (amphibiousMode(state, rules, playerId, opts)) {
    for (const [type, def] of seaEnablers) {
      if (hasOrBuilding(type)) continue;
      wanted.unshift({ type, province: def.coastal ? portSite(state, playerId) : front });
    }
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
  if (isSeaProvince(province)) return false;
  return province.owner === null || (province.owner !== playerId && areHostile(state, playerId, province.owner));
}

/** True if the army would beat whatever enemy force stands in the province. */
function canHold(
  state: GameState,
  rules: Ruleset,
  army: Army,
  provinceId: ProvinceId,
  opts: AiOptions,
  seen: ReadonlySet<ProvinceId>,
): boolean {
  // Out of sight means unknown: the AI assumes the province is empty.
  if (!seen.has(provinceId)) return true;
  const defenders = state.armies.filter((a) => a.location === provinceId && areHostile(state, army.owner, a.owner));
  if (defenders.length === 0) return true;

  const preview = previewBattle(rules, army.units, sumUnits(defenders.map((a) => a.units)));
  return preview.winner === 'attacker' && preview.attackerHpLeft >= opts.minHpLeft;
}

function movePhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  let current = state;
  const seen = visibleProvinces(state, rules, playerId);
  const walk = landStepRule(state.provinces);
  const amphibious = amphibiousMode(state, rules, playerId, opts);
  const mine = state.armies
    .filter((a) => a.owner === playerId)
    .sort((x, y) => x.id.localeCompare(y.id));

  for (const original of mine) {
    // Re-read the army: previous orders in this loop never change other armies, but stay safe.
    const army = current.armies.find((a) => a.id === original.id);
    if (!army || army.order || totalCount(army.units) <= 0) continue;
    if (armyKind(rules, army.units) !== 'land') continue; // fleets and aircraft have their own phases
    if (hostileAt(current, playerId, army.location)) continue; // engaged in a battle

    // Nothing left to conquer on foot: troops gather at the port to be shipped out.
    const port = amphibious ? portProvince(current, rules, playerId) : null;
    if (port !== null && army.location !== port) {
      const toPort = findPath(current.edges, army.location, port, walk);
      if (toPort) {
        const result = orderMove(current, playerId, army.id, port, rules);
        if (result.ok) current = result.state;
      }
      continue;
    }
    if (totalCount(army.units) < opts.minAttackUnits) continue; // too small, keep growing

    // Production is compared to the best province of the map, so the AI does not
    // depend on the resource scale of the ruleset.
    const topProduction = Math.max(1, ...current.provinces.map((p) => p.production));

    let best: { id: ProvinceId; score: number } | null = null;
    for (const target of current.provinces) {
      if (!isTarget(current, playerId, target)) continue;

      const route = findPath(current.edges, army.location, target.id, walk);
      if (!route) continue;

      // Every province on the way (and the target) must be winnable, because the
      // army stops and fights as soon as it meets an enemy.
      if (!route.path.every((id) => canHold(current, rules, army, id, opts, seen))) continue;

      // Prefer close targets, enemy-owned ones, and productive ones.
      const score = route.distance - (target.owner !== null ? 1 : 0) - (target.production / topProduction) * 0.3;
      if (!best || score < best.score || (score === best.score && target.id < best.id)) {
        best = { id: target.id, score };
      }
    }

    if (best) {
      const result = orderMove(current, playerId, army.id, best.id, rules);
      if (result.ok) current = result.state;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Amphibious planning
// ---------------------------------------------------------------------------

/** Provinces the player's land troops can walk to, starting from every province they own. */
function landReach(state: GameState, playerId: PlayerId): Set<ProvinceId> {
  const walk = landStepRule(state.provinces);
  const reached = new Set<ProvinceId>(state.provinces.filter((p) => p.owner === playerId).map((p) => p.id));
  const stack = [...reached];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const edge of state.edges) {
      const other = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (other === null || reached.has(other) || !walk(current, other)) continue;
      reached.add(other);
      stack.push(other);
    }
  }
  return reached;
}

/**
 * True when the AI should think about ships: the map has seas, it has no target left that it
 * can walk to, and some target on a coast exists.
 */
function amphibiousMode(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): boolean {
  if (!opts.navy || !state.provinces.some(isSeaProvince)) return false;
  if (!Object.values(rules.units).some((u) => u.domain === 'sea')) return false;
  if (state.provinces.every((p) => p.owner !== playerId)) return false;
  const targets = state.provinces.filter((p) => isTarget(state, playerId, p));
  const reached = landReach(state, playerId);
  if (targets.some((t) => reached.has(t.id))) return false;
  return targets.some((t) => isCoastal(state, t.id));
}

/** The province where ships are built and troops gather: an owned, calm province with a harbor. */
function portProvince(state: GameState, rules: Ruleset, playerId: PlayerId): ProvinceId | null {
  const ports = state.provinces
    .filter(
      (p) =>
        p.owner === playerId &&
        p.buildings.some((b) => rules.buildings[b]?.harbor === true) &&
        !hostileAt(state, playerId, p.id),
    )
    .map((p) => p.id)
    .sort();
  return ports[0] ?? null;
}

/** Where to build the port: the owned coastal province closest to a coast we want to reach. */
function portSite(state: GameState, playerId: PlayerId): ProvinceId | null {
  const targets = state.provinces.filter((p) => isTarget(state, playerId, p) && isCoastal(state, p.id));
  let best: { id: ProvinceId; distance: number } | null = null;
  for (const province of [...state.provinces].sort((x, y) => x.id.localeCompare(y.id))) {
    if (province.owner !== playerId || !isCoastal(state, province.id) || hostileAt(state, playerId, province.id)) continue;
    let nearest = Infinity;
    for (const target of targets) {
      const route = findPath(state.edges, province.id, target.id);
      if (route) nearest = Math.min(nearest, route.distance);
    }
    if (!best || nearest < best.distance) best = { id: province.id, distance: nearest };
  }
  return best?.id ?? null;
}

/** True if these units would beat whatever enemy force is visible in the province. */
function canBeat(
  state: GameState,
  rules: Ruleset,
  owner: PlayerId,
  units: Army['units'],
  provinceId: ProvinceId,
  opts: AiOptions,
  seen: ReadonlySet<ProvinceId>,
): boolean {
  if (!seen.has(provinceId)) return true; // unknown: assume empty
  const defenders = state.armies.filter((a) => a.location === provinceId && areHostile(state, owner, a.owner));
  if (defenders.length === 0) return true;
  const atSea = state.provinces.some((p) => p.id === provinceId && isSeaProvince(p));
  const preview = previewBattle(
    rules,
    combatUnits(rules, units, atSea),
    combatUnits(rules, sumUnits(defenders.map((a) => a.units)), atSea),
  );
  return preview.winner === 'attacker' && preview.attackerHpLeft >= opts.minHpLeft;
}

// ---------------------------------------------------------------------------
// Air force
// ---------------------------------------------------------------------------

function airPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  if (!opts.airForce) return state;
  let current = state;
  const seen = visibleProvinces(state, rules, playerId);
  const bases = airbasesOf(state, rules, playerId);
  const mine = state.armies
    .filter((a) => a.owner === playerId)
    .sort((x, y) => x.id.localeCompare(y.id));

  for (const original of mine) {
    const army = current.armies.find((a) => a.id === original.id);
    if (!army || army.order || armyKind(rules, army.units) !== 'air') continue;

    const atBase = bases.includes(army.location);
    if (hostileAt(current, playerId, army.location)) {
      // In a fight away from base: keep fighting while winning, fly home when losing.
      if (!atBase && !canBeat(current, rules, playerId, army.units, army.location, opts, seen)) {
        const home = nearestBase(current, rules, army, bases);
        if (home) {
          const result = orderMove(current, playerId, army.id, home, rules);
          if (result.ok) current = result.state;
        }
      }
      continue;
    }
    if (!atBase) continue; // idle away from base: the tick sends it home
    if (Object.values(army.units).reduce((sum, n) => sum + n, 0) < opts.minAirUnits) continue;

    // The closest visible enemy force that the raid would beat.
    let best: { id: ProvinceId; distance: number } | null = null;
    const targets = new Set(
      current.armies.filter((a) => areHostile(current, playerId, a.owner) && seen.has(a.location)).map((a) => a.location),
    );
    for (const target of [...targets].sort()) {
      const route = findArmyPath(current, rules, army, target);
      if (!route || !canBeat(current, rules, playerId, army.units, target, opts, seen)) continue;
      if (!best || route.distance < best.distance) best = { id: target, distance: route.distance };
    }
    if (best) {
      const result = orderMove(current, playerId, army.id, best.id, rules);
      if (result.ok) current = result.state;
    }
  }
  return current;
}

function nearestBase(state: GameState, rules: Ruleset, army: Army, bases: ProvinceId[]): ProvinceId | null {
  let best: { id: ProvinceId; distance: number } | null = null;
  for (const base of bases) {
    const route = findArmyPath(state, rules, army, base);
    if (route && (!best || route.distance < best.distance)) best = { id: base, distance: route.distance };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// Navy
// ---------------------------------------------------------------------------

function navyPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  if (!opts.navy) return state;
  let current = state;
  const seen = visibleProvinces(state, rules, playerId);
  const port = portProvince(state, rules, playerId);
  const fleets = state.armies
    .filter((a) => a.owner === playerId && armyKind(rules, a.units) === 'sea')
    .sort((x, y) => x.id.localeCompare(y.id));

  for (const original of fleets) {
    let fleet = current.armies.find((a) => a.id === original.id);
    if (!fleet || fleet.order || hostileAt(current, playerId, fleet.location)) continue;
    const here = current.provinces.find((p) => p.id === fleet?.location);
    if (!here) continue;

    // At sea and idle (a landing is over): back to the port.
    if (isSeaProvince(here)) {
      if (port !== null && findArmyPath(current, rules, fleet, port)) {
        const result = orderMove(current, playerId, fleet.id, port, rules);
        if (result.ok) current = result.state;
      }
      continue;
    }
    if (!canDockAt(current, rules, playerId, here)) continue;

    // Docked: load an idle land army that fits, if a landing is possible.
    if (landTroops(rules, fleet.units) === 0) {
      const troops = current.armies
        .filter(
          (a) =>
            a.owner === playerId &&
            a.location === fleet?.location &&
            a.order === null &&
            armyKind(rules, a.units) === 'land' &&
            hasLandUnits(rules, a.units),
        )
        .sort((x, y) => x.id.localeCompare(y.id))[0];
      if (!troops) continue;
      if (landTroops(rules, troops.units) < opts.minAttackUnits) continue;
      if (landTroops(rules, troops.units) > cargoCapacity(rules, fleet.units) + 1e-9) continue;

      const loaded = { ...fleet, units: sumUnits([fleet.units, troops.units]) };
      if (!landingTarget(current, rules, playerId, loaded, opts, seen)) continue;
      const embarked = orderEmbark(current, rules, playerId, troops.id, fleet.id);
      if (!embarked.ok) continue;
      current = embarked.state;
      fleet = current.armies.find((a) => a.id === original.id);
      if (!fleet) continue;
    }

    const target = landingTarget(current, rules, playerId, fleet, opts, seen);
    if (!target) continue;
    const result = orderMove(current, playerId, fleet.id, target, rules);
    if (result.ok) current = result.state;
  }
  return current;
}

/**
 * The coast a loaded fleet should land on: the closest province it can take, judged with
 * previewBattle(). Every sea province on the way must be passable for the ships, and the
 * troops must beat the visible defenders on land.
 */
function landingTarget(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  fleet: Army,
  opts: AiOptions,
  seen: ReadonlySet<ProvinceId>,
): ProvinceId | null {
  const landing = splitByDomain(rules, fleet.units).land;
  const topProduction = Math.max(1, ...state.provinces.map((p) => p.production));
  let best: { id: ProvinceId; score: number } | null = null;

  for (const target of state.provinces) {
    if (!isTarget(state, playerId, target) || !isCoastal(state, target.id)) continue;
    const route = findArmyPath(state, rules, fleet, target.id);
    if (!route) continue;

    const last = route.path.length - 1;
    const safe = route.path.every((id, i) =>
      i === last
        ? canBeat(state, rules, playerId, landing, id, opts, seen)
        : canBeat(state, rules, playerId, fleet.units, id, opts, seen),
    );
    if (!safe) continue;

    const score = route.distance - (target.owner !== null ? 1 : 0) - (target.production / topProduction) * 0.3;
    if (!best || score < best.score || (score === best.score && target.id < best.id)) {
      best = { id: target.id, score };
    }
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// Espionage
// ---------------------------------------------------------------------------

/** Travel distance from the nearest of the `sources` to every province (multi-source Dijkstra). */
function distancesFrom(state: GameState, sources: ProvinceId[]): Map<ProvinceId, number> {
  const adjacency = buildAdjacency(state.edges);
  const best = new Map<ProvinceId, number>(sources.map((id) => [id, 0]));
  const open = new Set<ProvinceId>(sources);
  while (open.size > 0) {
    let current: ProvinceId | null = null;
    for (const id of open) {
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

/** What a building is worth to an enemy: the price of building it again. */
function buildingValue(def: BuildingDef): number {
  return Object.values(def.cost).reduce((sum, amount) => sum + amount, 0);
}

function spyPhase(state: GameState, rules: Ruleset, playerId: PlayerId, opts: AiOptions): GameState {
  const espionage = rules.espionage;
  if (!opts.spies || !espionage) return state;
  let current = state;

  // 1. Spies in place: sabotage the best building, or spread disinformation, if the cover lasts.
  for (const spyId of state.spies.filter((s) => s.owner === playerId).map((s) => s.id)) {
    const spy = current.spies.find((s) => s.id === spyId);
    if (!spy || !isSpyInPlace(spy) || spy.mission) continue;
    const province = current.provinces.find((p) => p.id === spy.provinceId);
    // Only harm players we are at war with.
    if (!province || province.owner === null || !areHostile(current, playerId, province.owner)) continue;

    let order: ReturnType<typeof orderSpyMission> | null = null;
    if (spy.coverLeft >= espionage.sabotage.ticks) {
      const target = [...province.buildings]
        .filter((id) => rules.buildings[id] !== undefined)
        .sort((x, y) => buildingValue(rules.buildings[y] as BuildingDef) - buildingValue(rules.buildings[x] as BuildingDef) || x.localeCompare(y))[0];
      if (target !== undefined) order = orderSpyMission(current, rules, playerId, spy.id, { kind: 'sabotage', buildingType: target });
    }
    if (!order?.ok && spy.coverLeft >= espionage.disinformation.ticks && province.morale >= opts.minMoraleToHarm) {
      order = orderSpyMission(current, rules, playerId, spy.id, { kind: 'disinformation' });
    }
    if (order?.ok) current = order.state;
  }

  // 2. Now and then, send a new spy to the closest enemy province nobody is watching yet.
  if (current.tick % Math.max(1, opts.spyInterval) !== 0) return current;
  const mine = current.spies.filter((s) => s.owner === playerId);
  if (mine.length >= Math.min(opts.maxSpies, espionage.maxSpies)) return current;

  const player = current.players.find((p) => p.id === playerId);
  if (!player) return current;
  for (const [resource, amount] of Object.entries(espionage.cost)) {
    if ((player.stockpile[resource] ?? 0) - amount < opts.spyReserve) return current;
  }

  const own = current.provinces.filter((p) => p.owner === playerId).map((p) => p.id);
  const distance = distancesFrom(current, own);
  const target = current.provinces
    .filter(
      (p) =>
        p.owner !== null &&
        areHostile(current, playerId, p.owner) &&
        canSpyOn(current, playerId, p) &&
        !mine.some((s) => s.provinceId === p.id),
    )
    .sort((x, y) => (distance.get(x.id) ?? Infinity) - (distance.get(y.id) ?? Infinity) || x.id.localeCompare(y.id))[0];
  if (!target) return current;

  const result = orderSpy(current, rules, playerId, target.id);
  return result.ok ? result.state : current;
}
