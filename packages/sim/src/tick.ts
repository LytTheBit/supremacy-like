import { bombardPower, resolveRound, scaleUnits, shellingSurvival, sumUnits, totalCount } from './combat';
import { areHostile, processDiplomacy } from './diplomacy';
import { processEspionage } from './espionage';
import { productionMultiplier } from './buildings';
import { MAX_MORALE, moraleProductionFactor } from './morale';
import { buildAdjacency, makeEdgeDistance } from './pathfinding';
import {
  airbasesOf,
  armyKind,
  canDockAt,
  combatUnits,
  findArmyPath,
  hasAirUnits,
  hasLandUnits,
  hasNavalUnits,
  isSeaProvince,
  landTroops,
  makeStepRule,
  splitByDomain,
} from './naval';
import { freshArmyId } from './world';
import { checkVictory } from './victory';
import type { Army, ArmyId, GameState, PlayerId, ProvinceId, Ruleset, Units } from './types';

/**
 * Advances the game by one tick. Pure function: returns a new state.
 *
 * Order of phases inside a tick:
 *   0. diplomacy  - declarations of war start, truces run out, unanswered proposals expire
 *   1. movement   - armies advance along their orders (fleets land their troops on arrival)
 *   2. combat     - armies of players at war in the same province fight one round (cargo does not fight at sea)
 *      bombard    - fleets at sea shell the enemy armies on an adjacent coast (one-sided)
 *      recall     - idle aircraft away from an airbase fly back (they crash if no base is in reach)
 *   3. morale     - owned provinces regain morale
 *   4. conquest   - a province held only by enemies of its owner changes hands (morale drops)
 *   5. training   - recruit batches advance; finished ones become armies
 *   6. building   - constructions advance; finished ones are added to their province
 *      espionage  - spies get into place, missions are carried out, covers run out
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
  bombardCoasts(next, rules);
  recallAircraft(next, rules);
  recoverMorale(next, rules);
  resolveConquest(next, rules);
  processTraining(next, rules);
  processConstruction(next);
  processEspionage(next, rules);
  mergeIdleArmies(next, rules);
  produceResources(next, rules);
  checkVictory(next, rules);

  return next;
}

/**
 * An army moves at the speed of its slowest unit type. Land units carried by ships ride at the
 * speed of the ships.
 */
export function armySpeed(rules: Ruleset, units: Units): number {
  const naval = hasNavalUnits(rules, units);
  let speed = Infinity;
  for (const [type, count] of Object.entries(units)) {
    if (count <= 0) continue;
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    if (naval && def.domain !== 'sea') continue;
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

    // Armies engaged in a battle cannot leave (no retreat mechanic yet), except aircraft.
    if (!hasAirUnits(rules, army.units) && hasHostileAt(state, army.owner, army.location)) continue;

    const speed = armySpeed(rules, army.units);
    if (speed <= 0) continue;

    const step = makeStepRule(state, rules, army);
    order.progress += speed;

    while (order.path.length > 0) {
      const nextProvince = order.path[0];
      if (nextProvince === undefined) break;
      const distance = edgeDistance(army.location, nextProvince);
      if (distance === undefined || !step(army.location, nextProvince)) {
        // The graph or the situation changed under the order (e.g. the port is gone): drop it.
        army.order = null;
        break;
      }
      if (order.progress < distance) break;

      order.progress -= distance;
      const from = army.location;
      army.location = nextProvince;
      order.path.shift();
      const landed = unloadAtLanding(state, rules, army, from);

      // The army stops at its destination, after a landing, or as soon as it meets an enemy.
      if (order.path.length === 0 || landed || hasHostileAt(state, army.owner, army.location)) {
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

/**
 * A fleet that reaches a land province without a port of its owner (or an ally) lands its
 * troops: the land units stay in the army (which keeps its id), the ships stay at sea in the
 * province they came from, as a new army. Returns true if that happened.
 */
function unloadAtLanding(state: GameState, rules: Ruleset, army: Army, from: ProvinceId): boolean {
  const here = state.provinces.find((p) => p.id === army.location);
  if (!here || isSeaProvince(here) || !hasNavalUnits(rules, army.units)) return false;
  if (canDockAt(state, rules, army.owner, here)) return false;
  const { land, sea } = splitByDomain(rules, army.units);
  if (Object.keys(land).length === 0) return false;

  const fleetId = freshArmyId(state);
  state.armies.push({ id: fleetId, owner: army.owner, location: from, units: sea, order: null });
  army.units = land;
  state.events.push({ tick: state.tick, type: 'army_landed', armyId: army.id, fleetId, provinceId: here.id });
  return true;
}

/**
 * Fleets at sea shell the enemy armies in an adjacent land province, one province per fleet:
 * the one with the most troops (ties: lowest id). Only ships with a `bombard` value fire, never
 * while the fleet is in a fight at sea or has `holdFire` set. The troops cannot fire back.
 */
function bombardCoasts(state: GameState, rules: Ruleset): void {
  const adjacency = buildAdjacency(state.edges);
  const provinces = new Map(state.provinces.map((p) => [p.id, p]));
  const destroyed = new Set<ArmyId>();

  for (const fleet of sortedById(state.armies)) {
    if (fleet.holdFire || destroyed.has(fleet.id)) continue;
    const power = bombardPower(rules, fleet.units);
    if (power <= 0) continue;
    const here = provinces.get(fleet.location);
    if (!here || !isSeaProvince(here) || hasHostileAt(state, fleet.owner, fleet.location)) continue;

    let target: { id: ProvinceId; troops: number } | null = null;
    for (const link of [...(adjacency.get(fleet.location) ?? [])].sort((x, y) => x.to.localeCompare(y.to))) {
      const province = provinces.get(link.to);
      if (!province || isSeaProvince(province)) continue;
      const troops = state.armies
        .filter((a) => a.location === link.to && areHostile(state, fleet.owner, a.owner) && !destroyed.has(a.id))
        .reduce((sum, a) => sum + totalCount(a.units), 0);
      if (troops > 0 && (!target || troops > target.troops)) target = { id: link.to, troops };
    }
    if (!target) continue;

    const defenders = state.armies.filter(
      (a) => a.location === target.id && areHostile(state, fleet.owner, a.owner) && !destroyed.has(a.id),
    );
    const survival = shellingSurvival(rules, power, sumUnits(defenders.map((a) => a.units)));
    state.events.push({ tick: state.tick, type: 'coast_bombarded', armyId: fleet.id, provinceId: target.id });
    if (survival >= 1) continue;
    for (const army of defenders) {
      army.units = scaleUnits(army.units, survival);
      if (survival <= 0) {
        destroyed.add(army.id);
        state.events.push({ tick: state.tick, type: 'army_destroyed', armyId: army.id, provinceId: target.id });
      }
    }
  }
  if (destroyed.size > 0) state.armies = state.armies.filter((a) => !destroyed.has(a.id));
}

/**
 * Aircraft cannot stay away from their bases. An idle air army that is not at an airbase of
 * its owner (or an ally) and is not in a fight flies back to the nearest base by itself. If no
 * base is within reach any more (it was lost or conquered) the aircraft are lost.
 */
function recallAircraft(state: GameState, rules: Ruleset): void {
  const lost = new Set<ArmyId>();

  for (const army of sortedById(state.armies)) {
    if (army.order !== null || armyKind(rules, army.units) !== 'air') continue;
    const bases = airbasesOf(state, rules, army.owner);
    if (bases.includes(army.location)) continue;
    if (hasHostileAt(state, army.owner, army.location)) continue; // still fighting

    let best: { path: ProvinceId[]; distance: number } | null = null;
    for (const base of bases) {
      const route = findArmyPath(state, rules, army, base);
      if (route && (!best || route.distance < best.distance)) best = route;
    }
    if (best) {
      army.order = { path: best.path, progress: 0 };
    } else {
      lost.add(army.id);
      state.events.push({ tick: state.tick, type: 'army_destroyed', armyId: army.id, provinceId: army.location });
    }
  }
  if (lost.size > 0) state.armies = state.armies.filter((a) => !lost.has(a.id));
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

    // At sea only the ships fight; the cargo shares their fate through the survival factor.
    const atSea = state.provinces.some((p) => p.id === provinceId && isSeaProvince(p));
    const survival = resolveRound(
      rules,
      sides.map((group) => combatUnits(rules, sumUnits(group.map((a) => a.units)), atSea)),
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
    if (isSeaProvince(province)) continue;
    const present = state.armies.filter((a) => a.location === province.id);
    if (present.length === 0) continue;

    const owners = [...new Set(present.map((a) => a.owner))].sort();
    if (province.owner !== null && owners.includes(province.owner)) continue;
    // A battle is still going on: nobody takes the province yet.
    if (owners.some((x) => owners.some((y) => areHostile(state, x, y)))) continue;

    // Only land troops take provinces: a fleet alone (e.g. in the port of a former ally) never does.
    const landOwners = owners.filter((o) => present.some((a) => a.owner === o && hasLandUnits(rules, a.units)));
    const candidates = landOwners.filter((o) => province.owner === null || areHostile(state, province.owner, o));
    if (candidates.length === 0) continue;

    const troops = (owner: PlayerId) =>
      present.filter((a) => a.owner === owner).reduce((sum, a) => sum + landTroops(rules, a.units), 0);
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
function processTraining(state: GameState, rules: Ruleset): void {
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

    // Ships join a fleet, land units a land army: the two kinds never share an army by themselves.
    const jobKind = armyKind(rules, { [job.unitType]: 1 });
    const garrison = sortedById(state.armies).find(
      (a) =>
        a.owner === job.owner &&
        a.location === job.provinceId &&
        a.order === null &&
        armyKind(rules, a.units) === jobKind,
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

/**
 * Armies of the same owner and kind (land, fleet or air) that stand in the same province
 * without orders are merged into the one with the lowest id. Armies with a movement order keep
 * their identity so they can keep marching.
 */
function mergeIdleArmies(state: GameState, rules: Ruleset): void {
  const keepers = new Map<string, Army>();
  const removed = new Set<ArmyId>();

  for (const army of sortedById(state.armies)) {
    if (army.order !== null) continue;
    // Land armies, fleets (with or without cargo) and air armies stay separate: embark with orderEmbark().
    const key = `${army.owner}|${army.location}|${armyKind(rules, army.units)}`;
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
