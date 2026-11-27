import { buildingLevel, removeBuilding, setBuildingLevel } from './buildings';
import { interceptRecent } from './chat';
import { alliesOf } from './diplomacy';
import { isSeaProvince } from './naval';
import type {
  GameState,
  PlayerId,
  Province,
  ProvinceId,
  Ruleset,
  Spy,
  SpyMissionRequest,
  SpyRemovedReason,
} from './types';

/**
 * Espionage.
 *
 * A player sends a spy to a land province owned by someone else (an enemy, a truce partner, even
 * a player nobody is at war with, but never an ally or themselves). The spy needs
 * `infiltrateTicks` to get into place. While in place it:
 *
 *  - watches: the province is in the owner's sight (buildings, morale, armies), the jobs under way
 *    there and the stockpile of the province's owner become known (see `viewFor`);
 *  - can be given one mission: sabotage (a building is destroyed) or disinformation (the morale of
 *    the province drops). The spy leaves after a successful mission.
 *
 * Nothing is random: a spy's cover lasts exactly `coverTicks` once it is in place, then it is caught.
 * A mission that needs more ticks than the cover has left ends with the spy being caught.
 * Missing counter-espionage is a known simplification (see the README).
 *
 * A spy is dropped (`target_changed`) when its province stops being foreign to it: it was
 * conquered, it became an ally's, or the owner lost it.
 */

export type SpyError =
  | 'game_over'
  | 'espionage_unavailable'
  | 'player_not_found'
  | 'player_eliminated'
  | 'province_not_found'
  | 'not_spyable'
  | 'already_spied'
  | 'too_many_spies'
  | 'insufficient_resources'
  | 'spy_not_found'
  | 'not_owner'
  | 'spy_not_ready'
  | 'mission_in_progress'
  | 'no_such_building';

export type SpyResult = { ok: true; state: GameState } | { ok: false; error: SpyError };

/** True when the spy has reached its province: it watches and can take a mission. */
export function isSpyInPlace(spy: Spy): boolean {
  return spy.infiltrationLeft <= 0;
}

/** Spies of a player and of their allies that are in place: the eyes the team has abroad. */
export function activeSpies(state: GameState, team: ReadonlySet<PlayerId>): Spy[] {
  return state.spies.filter((s) => team.has(s.owner) && isSpyInPlace(s));
}

/** Provinces where the team has a spy in place. They count as in sight. */
export function spiedProvinces(state: GameState, team: ReadonlySet<PlayerId>): Set<ProvinceId> {
  return new Set(activeSpies(state, team).map((s) => s.provinceId));
}

/** The spy a player has in a province, if any. */
export function spyAt(state: GameState, playerId: PlayerId, provinceId: ProvinceId): Spy | undefined {
  return state.spies.find((s) => s.owner === playerId && s.provinceId === provinceId);
}

/** Can this player spy on that province at all? (Foreign land owned by somebody who is not an ally.) */
export function canSpyOn(state: GameState, playerId: PlayerId, province: Province): boolean {
  if (isSeaProvince(province) || province.owner === null || province.owner === playerId) return false;
  return !alliesOf(state, playerId).includes(province.owner);
}

/** Orders a spy to be sent to a province. The cost is paid at once. Pure function. */
export function orderSpy(state: GameState, rules: Ruleset, playerId: PlayerId, provinceId: ProvinceId): SpyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const espionage = rules.espionage;
  if (!espionage) return { ok: false, error: 'espionage_unavailable' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'player_not_found' };
  if (state.eliminated.includes(playerId)) return { ok: false, error: 'player_eliminated' };
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, error: 'province_not_found' };
  if (!canSpyOn(state, playerId, province)) return { ok: false, error: 'not_spyable' };
  if (spyAt(state, playerId, provinceId)) return { ok: false, error: 'already_spied' };
  if (state.spies.filter((s) => s.owner === playerId).length >= espionage.maxSpies) {
    return { ok: false, error: 'too_many_spies' };
  }
  for (const [resource, amount] of Object.entries(espionage.cost)) {
    if ((player.stockpile[resource] ?? 0) < amount) return { ok: false, error: 'insufficient_resources' };
  }

  const next = structuredClone(state);
  const nextPlayer = next.players.find((p) => p.id === playerId);
  if (!nextPlayer) return { ok: false, error: 'player_not_found' };
  for (const [resource, amount] of Object.entries(espionage.cost)) {
    nextPlayer.stockpile[resource] = (nextPlayer.stockpile[resource] ?? 0) - amount;
  }
  next.spies.push({
    id: `spy-${next.nextId}`,
    owner: playerId,
    provinceId,
    infiltrationLeft: espionage.infiltrateTicks,
    coverLeft: espionage.coverTicks,
    mission: null,
  });
  next.nextId += 1;
  return { ok: true, state: next };
}

/**
 * Gives a spy in place its mission. Sabotage needs a building that stands in the province now
 * (the spy sees it). Only one mission at a time. Pure function.
 */
export function orderSpyMission(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  spyId: string,
  mission: SpyMissionRequest,
): SpyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const espionage = rules.espionage;
  if (!espionage) return { ok: false, error: 'espionage_unavailable' };
  const spy = state.spies.find((s) => s.id === spyId);
  if (!spy) return { ok: false, error: 'spy_not_found' };
  if (spy.owner !== playerId) return { ok: false, error: 'not_owner' };
  if (!isSpyInPlace(spy)) return { ok: false, error: 'spy_not_ready' };
  if (spy.mission) return { ok: false, error: 'mission_in_progress' };
  if (mission.kind === 'sabotage') {
    const province = state.provinces.find((p) => p.id === spy.provinceId);
    if (!province?.buildings.includes(mission.buildingType)) return { ok: false, error: 'no_such_building' };
  }

  const next = structuredClone(state);
  const nextSpy = next.spies.find((s) => s.id === spyId);
  if (!nextSpy) return { ok: false, error: 'spy_not_found' };
  nextSpy.mission =
    mission.kind === 'sabotage'
      ? { kind: 'sabotage', buildingType: mission.buildingType, ticksLeft: espionage.sabotage.ticks }
      : { kind: 'disinformation', ticksLeft: espionage.disinformation.ticks };
  return { ok: true, state: next };
}

/** Calls a spy home (it works at any time, even before it is in place). The cost is not refunded. */
export function orderRecallSpy(state: GameState, playerId: PlayerId, spyId: string): SpyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const spy = state.spies.find((s) => s.id === spyId);
  if (!spy) return { ok: false, error: 'spy_not_found' };
  if (spy.owner !== playerId) return { ok: false, error: 'not_owner' };

  const next = structuredClone(state);
  removeSpy(next, spy, 'recalled');
  return { ok: true, state: next };
}

function removeSpy(state: GameState, spy: Spy, reason: SpyRemovedReason, silent = false): void {
  state.spies = state.spies.filter((s) => s.id !== spy.id);
  if (silent) return;
  const province = state.provinces.find((p) => p.id === spy.provinceId);
  state.events.push({
    tick: state.tick,
    type: 'spy_removed',
    spyId: spy.id,
    owner: spy.owner,
    provinceId: spy.provinceId,
    target: province?.owner ?? null,
    reason,
  });
}

/**
 * One tick of espionage (a phase of `tick()`): spies get into place, missions advance and are
 * carried out, covers run out. Mutates the private copy made by `tick()`.
 */
export function processEspionage(state: GameState, rules: Ruleset): void {
  const espionage = rules.espionage;
  for (const spy of [...state.spies].sort((x, y) => x.id.localeCompare(y.id, 'en', { numeric: true }))) {
    // Spies of a player who is out of the game just vanish.
    if (!espionage || state.eliminated.includes(spy.owner)) {
      removeSpy(state, spy, 'target_changed', true);
      continue;
    }
    const province = state.provinces.find((p) => p.id === spy.provinceId);
    if (!province || !canSpyOn(state, spy.owner, province)) {
      removeSpy(state, spy, 'target_changed');
      continue;
    }

    if (!isSpyInPlace(spy)) {
      spy.infiltrationLeft -= 1;
      if (isSpyInPlace(spy)) {
        state.events.push({
          tick: state.tick,
          type: 'spy_in_place',
          spyId: spy.id,
          owner: spy.owner,
          provinceId: spy.provinceId,
        });
        // A spy that arrives also reads the latest messages of the owner: the context of what it will hear.
        if (province.owner !== null) interceptRecent(state, spy.owner, province.owner, espionage.chatContext ?? 6);
      }
      continue;
    }

    const mission = spy.mission;
    if (mission) {
      mission.ticksLeft -= 1;
      if (mission.ticksLeft <= 0 && province.owner !== null) {
        if (mission.kind === 'sabotage') {
          if (province.buildings.includes(mission.buildingType)) {
            // A building with several levels loses one; a single level is destroyed.
            const level = buildingLevel(province, mission.buildingType);
            if (level > 1) setBuildingLevel(province, mission.buildingType, level - 1);
            else removeBuilding(province, mission.buildingType);
            state.events.push({
              tick: state.tick,
              type: 'building_sabotaged',
              provinceId: province.id,
              buildingType: mission.buildingType,
              by: spy.owner,
              target: province.owner,
            });
            removeSpy(state, spy, 'mission_done');
            continue;
          }
          // The building is already gone: nothing to do, the spy goes on watching.
          spy.mission = null;
          state.events.push({
            tick: state.tick,
            type: 'spy_mission_failed',
            spyId: spy.id,
            owner: spy.owner,
            provinceId: province.id,
          });
        } else {
          const damage = Math.min(province.morale, espionage.disinformation.moraleDamage);
          province.morale -= damage;
          state.events.push({
            tick: state.tick,
            type: 'morale_sabotaged',
            provinceId: province.id,
            damage,
            by: spy.owner,
            target: province.owner,
          });
          removeSpy(state, spy, 'mission_done');
          continue;
        }
      }
    }

    spy.coverLeft -= 1;
    if (spy.coverLeft <= 0) removeSpy(state, spy, 'cover_blown');
  }
}
