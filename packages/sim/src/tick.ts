import { resolveRound, scaleUnits, sumUnits, totalCount } from './combat';
import { areHostile, processDiplomacy } from './diplomacy';
import { productionMultiplier } from './buildings';
import { MAX_MORALE, moraleProductionFactor } from './morale';
import { makeEdgeDistance } from './pathfinding';
import { checkVictory } from './victory';
import type { Army, ArmyId, GameState, PlayerId, ProvinceId, Ruleset, Units } from './types';

/**
 * Advances the game by one tick. Pure function: returns a new state.
 *
 * Order of phases inside a tick:
 *   0. diplomacy  - declarations of war start, truces run out, unanswered proposals expire
 *   1. movement   - armies advance along their orders
 *   2. combat     - armies of players at war in the same province fight one round
 *   3. morale     - owned provinces regain morale
 *   4. conquest   - a province held only by enemies of its owner changes hands (morale drops)
 *   5. training   - recruit batches advance; finished ones become armies
 *   6. building   - constructions advance; finished ones are added to their province
 *   7. merging    - idle armies of the same owner in the same province combine
 *   8. production - owned provinces add resources (scaled by buildings and morale)
 *   9. victory    - eliminations and win conditions are checked
 *
 * Once the game has an outcome, tick() returns an unchanged copy of the state (without events).
 */
export function tick(state: GameState, rules: Ruleset): GameState {
  if (state.rulesId !== rules.id) {
    throw new Error(`Ruleset mismatch: the game uses "${state.rulesId}" but "${rules.id}" was given`);
  }
  const next = structuredClone(state);
  // Events of the previous tick are dropped; those caused by orders since then (stamped with
  // this tick) are kept, so the interface sees them together with this tick's own events.
  next.events = next.outcome ? [] : next.events.filter((e) => e.tick > state.tick);
  if (next.outcome) return next;
  next.tick += 1;

  processDiplomacy(next);
  moveArmies(next, rules);
  resolveCombat(next, rules);
  recoverMorale(next, rules);
  resolveConquest(next, rules);
  processTraining(next);
  processConstruction(next);
  mergeIdleArmies(next);
  produceResources(next, rules);
  checkVictory(next, rules);

  return next;
}

/** An army moves at the speed of its slowest unit type. */
export function armySpeed(rules: Ruleset, units: Units): number {
  let speed = Infinity;
  for (const [type, count] of Object.entries(units)) {
    if (count <= 0) continue;
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    speed = Math.min(speed, def.speed);
  }
  return Number.isFinite(speed) ? speed : 0;
}

function sortedById(armies: Army[]): Army[] {
  return [...armies].sort((x, y) => x.id.localeCompare(y.id));
}

function hasHostileAt(state: GameState, owner: PlayerId, location: ProvinceId): boolean {
  return state.armies.some((a) => a.location === location && areHostile(state, owner, a.owner));
}

function moveArmies(state: GameState, rules: Ruleset): void {
  const edgeDistance = makeEdgeDistance(state.edges);

  for (const army of sortedById(state.armies)) {
    const order = army.order;
    if (!order) continue;

    // Armies engaged in a battle cannot leave (no retreat mechanic yet).
    if (hasHostileAt(state, army.owner, army.location)) continue;

    const speed = armySpeed(rules, army.units);
    if (speed <= 0) continue;

    order.progress += speed;

    while (order.path.length > 0) {
      const nextProvince = order.path[0];
      if (nextProvince === undefined) break;
      const distance = edgeDistance(army.location, nextProvince);
      if (distance === undefined) {
        // The graph changed under the order: drop it.
        army.order = null;
        break;
      }
      if (order.progress < distance) break;

      order.progress -= distance;
      army.location = nextProvince;
      order.path.shift();

      // The army stops at its destination, or as soon as it meets an enemy.
      if (order.path.length === 0 || hasHostileAt(state, army.owner, army.location)) {
        army.order = null;
        state.events.push({
          tick: state.tick,
          type: 'army_arrived',
          armyId: army.id,
          provinceId: army.location,
        });
        break;
      }
    }
  }
}

function resolveCombat(state: GameState, rules: Ruleset): void {
  const byProvince = new Map<ProvinceId, Army[]>();
  for (const army of state.armies) {
    const list = byProvince.get(army.location) ?? [];
    list.push(army);
    byProvince.set(army.location, list);
  }

  const destroyed = new Set<ArmyId>();

  for (const provinceId of [...byProvince.keys()].sort()) {
    const armies = byProvince.get(provinceId) ?? [];
    const owners = [...new Set(armies.map((a) => a.owner))].sort();
    if (owners.length < 2) continue;

    // One "side" per owner: all armies of the same owner fight together.
    // Owners that are not at war (truce partners, allies) stand side by side.
    const sides = owners.map((owner) => armies.filter((a) => a.owner === owner));
    const hostile = (i: number, j: number) => {
      const x = owners[i];
      const y = owners[j];
      return x !== undefined && y !== undefined && areHostile(state, x, y);
    };
    if (!owners.some((_, i) => owners.some((__, j) => i !== j && hostile(i, j)))) continue;

    const survival = resolveRound(
      rules,
      sides.map((group) => sumUnits(group.map((a) => a.units))),
      hostile,
    );

    // Only the owners that actually fight someone are named in the battle.
    const fighting = owners.filter((_, i) => owners.some((__, j) => i !== j && hostile(i, j)));
    state.events.push({ tick: state.tick, type: 'battle', provinceId, owners: fighting });

    sides.forEach((group, i) => {
      const factor = survival[i] ?? 0;
      for (const army of group) {
        if (factor <= 0) {
          destroyed.add(army.id);
          state.events.push({
            tick: state.tick,
            type: 'army_destroyed',
            armyId: army.id,
            provinceId,
          });
        } else {
          army.units = scaleUnits(army.units, factor);
        }
      }
    });
  }

  if (destroyed.size > 0) {
    state.armies = state.armies.filter((a) => !destroyed.has(a.id));
  }
}

/**
 * A province changes hands when armies stand in it, nobody there fights anybody else, the
 * owner (or an army of the owner) is not there, and at least one of the players present is at
 * war with the owner (any player counts for a neutral province). Truce partners and allies
 * of the owner never take it. When several allies take it together, the one with the most
 * troops there gets it (ties: lowest id).
 */
function resolveConquest(state: GameState, rules: Ruleset): void {
  for (const province of [...state.provinces].sort((x, y) => x.id.localeCompare(y.id))) {
    const present = state.armies.filter((a) => a.location === province.id);
    if (present.length === 0) continue;

    const owners = [...new Set(present.map((a) => a.owner))].sort();
    if (province.owner !== null && owners.includes(province.owner)) continue;
    // A battle is still going on: nobody takes the province yet.
    if (owners.some((x) => owners.some((y) => areHostile(state, x, y)))) continue;

    const candidates = owners.filter((o) => province.owner === null || areHostile(state, province.owner, o));
    if (candidates.length === 0) continue;

    const troops = (owner: PlayerId) =>
      present.filter((a) => a.owner === owner).reduce((sum, a) => sum + totalCount(a.units), 0);
    const conqueror = [...candidates].sort((x, y) => troops(y) - troops(x) || x.localeCompare(y))[0];
    if (conqueror === undefined || conqueror === province.owner) continue;

    state.events.push({
      tick: state.tick,
      type: 'province_conquered',
      provinceId: province.id,
      from: province.owner,
      to: conqueror,
    });
    province.owner = conqueror;
    province.morale = rules.morale.afterConquest;
  }
}

function produceResources(state: GameState, rules: Ruleset): void {
  for (const province of state.provinces) {
    if (province.owner === null) continue;
    const player = state.players.find((p) => p.id === province.owner);
    if (!player) continue;
    const produced =
      province.production * productionMultiplier(rules, province) * moraleProductionFactor(rules, province);
    player.stockpile[province.resource] = (player.stockpile[province.resource] ?? 0) + produced;
  }
}

/**
 * Advances every recruit batch by one tick.
 * - If the province changed hands during training, the batch is lost (no refund).
 * - A finished batch joins a stationary army of the same owner in that province,
 *   or becomes a new army.
 */
function processTraining(state: GameState): void {
  const remaining: GameState['recruitQueue'] = [];

  for (const job of state.recruitQueue) {
    job.ticksLeft -= 1;
    if (job.ticksLeft > 0) {
      remaining.push(job);
      continue;
    }

    const province = state.provinces.find((p) => p.id === job.provinceId);
    if (!province || province.owner !== job.owner) {
      state.events.push({
        tick: state.tick,
        type: 'recruit_cancelled',
        jobId: job.id,
        provinceId: job.provinceId,
      });
      continue;
    }

    const garrison = sortedById(state.armies).find(
      (a) => a.owner === job.owner && a.location === job.provinceId && a.order === null,
    );
    let armyId: ArmyId;
    if (garrison) {
      garrison.units[job.unitType] = (garrison.units[job.unitType] ?? 0) + job.count;
      armyId = garrison.id;
    } else {
      armyId = freshArmyId(state);
      state.armies.push({
        id: armyId,
        owner: job.owner,
        location: job.provinceId,
        units: { [job.unitType]: job.count },
        order: null,
      });
    }
    state.events.push({
      tick: state.tick,
      type: 'recruit_completed',
      jobId: job.id,
      armyId,
      provinceId: job.provinceId,
      unitType: job.unitType,
      count: job.count,
    });
  }

  state.recruitQueue = remaining;
}

/** Generates an army id that does not collide with existing ones. */
function freshArmyId(state: GameState): ArmyId {
  for (;;) {
    const candidate = `army-${state.nextId}`;
    state.nextId += 1;
    if (!state.armies.some((a) => a.id === candidate)) return candidate;
  }
}

/**
 * Armies of the same owner that stand in the same province without orders are
 * merged into the one with the lowest id. Armies with a movement order keep
 * their identity so they can keep marching.
 */
function mergeIdleArmies(state: GameState): void {
  const keepers = new Map<string, Army>();
  const removed = new Set<ArmyId>();

  for (const army of sortedById(state.armies)) {
    if (army.order !== null) continue;
    const key = `${army.owner}|${army.location}`;
    const keeper = keepers.get(key);
    if (!keeper) {
      keepers.set(key, army);
      continue;
    }
    keeper.units = sumUnits([keeper.units, army.units]);
    removed.add(army.id);
  }

  if (removed.size > 0) {
    state.armies = state.armies.filter((a) => !removed.has(a.id));
  }
}

/**
 * Advances every construction by one tick.
 * - If the province changed hands before completion, the construction is lost (no refund).
 * - Completed buildings stay in the province, even if it is conquered later.
 */
function processConstruction(state: GameState): void {
  const remaining: GameState['constructionQueue'] = [];

  for (const job of state.constructionQueue) {
    job.ticksLeft -= 1;
    if (job.ticksLeft > 0) {
      remaining.push(job);
      continue;
    }

    const province = state.provinces.find((p) => p.id === job.provinceId);
    if (!province || province.owner !== job.owner) {
      state.events.push({
        tick: state.tick,
        type: 'building_cancelled',
        jobId: job.id,
        provinceId: job.provinceId,
        buildingType: job.buildingType,
      });
      continue;
    }

    if (!province.buildings.includes(job.buildingType)) province.buildings.push(job.buildingType);
    state.events.push({
      tick: state.tick,
      type: 'building_completed',
      provinceId: job.provinceId,
      buildingType: job.buildingType,
    });
  }

  state.constructionQueue = remaining;
}

/** Owned provinces regain morale every tick, up to the maximum. */
function recoverMorale(state: GameState, rules: Ruleset): void {
  for (const province of state.provinces) {
    if (province.owner === null) continue;
    province.morale = Math.min(MAX_MORALE, province.morale + rules.morale.recoveryPerTick);
  }
}
