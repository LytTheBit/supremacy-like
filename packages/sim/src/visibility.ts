import { alliesOf } from './diplomacy';
import { spiedProvinces } from './espionage';
import type {
  Chat,
  BuildingId,
  GameEvent,
  GameState,
  PlayerId,
  ProvinceId,
  Ruleset,
  Units,
} from './types';

/**
 * Fog of war.
 *
 * A player sees a province when it lies within the vision of one of their provinces or armies,
 * or of those of an ally (allies share their vision). Vision is a travel distance along the
 * links between provinces: `rules.vision.provinceRadius` for owned provinces, and for armies
 * the best `UnitDef.vision` among their units (`rules.vision.unitRadius` when a unit does not
 * say). With `rules.vision.fog` off everything is visible.
 *
 * A spy in place (`espionage.ts`) puts its province in sight, and also shows the jobs under way
 * there and the stockpile of the province's owner.
 *
 * What fog hides: armies outside vision, the buildings and morale of provinces that are not
 * the player's (or an ally's) and are out of sight, the stockpiles and queues of other players.
 * Other players' spies are always hidden, fog or not.
 * The market book is public (orders, owners and prices); only the trades themselves are private.
 * What stays public: who owns each province, the map, treaties between players.
 */

/** What a player last saw of a province they cannot see now. */
export interface ProvinceMemory {
  /** The tick at which it was seen. */
  tick: number;
  buildings: BuildingId[];
  /** Levels of the buildings above level 1, as `Province.buildingLevels`. */
  buildingLevels?: Record<BuildingId, number>;
  morale: number;
}

export type MemoryMap = Record<ProvinceId, ProvinceMemory>;

export interface PlayerView {
  /** The game as this player knows it: a copy of the state with the hidden parts removed. */
  state: GameState;
  /** Provinces in sight right now, sorted. */
  visible: ProvinceId[];
  /** Last known buildings and morale of every province seen at least once. */
  memory: MemoryMap;
}

type Adjacency = Map<ProvinceId, { to: ProvinceId; distance: number }[]>;

function adjacencyOf(state: GameState): Adjacency {
  const map: Adjacency = new Map();
  for (const edge of state.edges) {
    (map.get(edge.a) ?? map.set(edge.a, []).get(edge.a))?.push({ to: edge.b, distance: edge.distance });
    (map.get(edge.b) ?? map.set(edge.b, []).get(edge.b))?.push({ to: edge.a, distance: edge.distance });
  }
  return map;
}

/** Provinces within `radius` of travel distance from `start` (the start itself included). */
function reach(adjacency: Adjacency, start: ProvinceId, radius: number): ProvinceId[] {
  const best = new Map<ProvinceId, number>([[start, 0]]);
  const open: ProvinceId[] = [start];
  while (open.length > 0) {
    // The graph is small: picking the nearest open node by scanning is plenty fast.
    let index = 0;
    for (let i = 1; i < open.length; i++) {
      if ((best.get(open[i] ?? '') ?? Infinity) < (best.get(open[index] ?? '') ?? Infinity)) index = i;
    }
    const [current] = open.splice(index, 1);
    if (current === undefined) break;
    const here = best.get(current) ?? 0;
    for (const link of adjacency.get(current) ?? []) {
      const total = here + link.distance;
      if (total > radius || total >= (best.get(link.to) ?? Infinity)) continue;
      best.set(link.to, total);
      if (!open.includes(link.to)) open.push(link.to);
    }
  }
  return [...best.keys()];
}

/** How far an army sees: the best vision among its units. */
export function armyVision(rules: Ruleset, units: Units): number {
  let best = 0;
  for (const [type, count] of Object.entries(units)) {
    if (count <= 0.001) continue;
    best = Math.max(best, rules.units[type]?.vision ?? rules.vision.unitRadius);
  }
  return best;
}

/** The player and their allies: everyone whose eyes the player can use. */
export function visionTeam(state: GameState, playerId: PlayerId): PlayerId[] {
  return [playerId, ...alliesOf(state, playerId)];
}

/** Provinces the player can see right now. */
export function visibleProvinces(state: GameState, rules: Ruleset, playerId: PlayerId): Set<ProvinceId> {
  if (!rules.vision.fog) return new Set(state.provinces.map((p) => p.id));

  const adjacency = adjacencyOf(state);
  const team = new Set(visionTeam(state, playerId));
  const seen = new Set<ProvinceId>();

  for (const province of state.provinces) {
    if (province.owner === null || !team.has(province.owner)) continue;
    for (const id of reach(adjacency, province.id, rules.vision.provinceRadius)) seen.add(id);
  }
  for (const army of state.armies) {
    if (!team.has(army.owner)) continue;
    for (const id of reach(adjacency, army.location, armyVision(rules, army.units))) seen.add(id);
  }
  for (const id of spiedProvinces(state, team)) seen.add(id);
  return seen;
}

/** True when every unit of the army is a stealth unit (a mixed army is not hidden). */
export function isStealthy(rules: Ruleset, units: Units): boolean {
  let any = false;
  for (const [type, count] of Object.entries(units)) {
    if (count <= 0.001) continue;
    if (rules.units[type]?.stealth !== true) return false;
    any = true;
  }
  return any;
}

/** Provinces within `vision.stealthRadius` (default 1) of an army or an owned province of the team. */
function stealthSeen(state: GameState, rules: Ruleset, team: ReadonlySet<PlayerId>): Set<ProvinceId> {
  const radius = rules.vision.stealthRadius ?? 1;
  const adjacency = adjacencyOf(state);
  const close = new Set<ProvinceId>();
  for (const province of state.provinces) {
    if (province.owner !== null && team.has(province.owner)) for (const id of reach(adjacency, province.id, radius)) close.add(id);
  }
  for (const army of state.armies) {
    if (team.has(army.owner)) for (const id of reach(adjacency, army.location, radius)) close.add(id);
  }
  return close;
}

/** True if a player may be told about an event. Events with no place (or public ones) always pass. */
export function isEventVisible(event: GameEvent, visible: ReadonlySet<ProvinceId>, playerId: PlayerId): boolean {
  switch (event.type) {
    case 'battle':
      return event.owners.includes(playerId) || visible.has(event.provinceId);
    // Espionage is secret: only the spy's owner hears about it, and the victim hears about the damage
    // (and about a spy that was caught), never about who did it.
    case 'spy_in_place':
    case 'spy_mission_failed':
      return event.owner === playerId;
    case 'spy_removed':
      return event.owner === playerId || (event.reason === 'cover_blown' && event.target === playerId);
    case 'building_sabotaged':
    case 'morale_sabotaged':
      return event.by === playerId || event.target === playerId;
    // Trades are private: the book is public, but who got what is not.
    case 'market_trade':
    case 'market_order_expired':
      return event.owner === playerId;
    // Deals and wiretaps are private to the people involved.
    case 'trade_offered':
    case 'trade_accepted':
    case 'trade_rejected':
    case 'trade_cancelled':
    case 'trade_expired':
    case 'gift_sent':
      return event.from === playerId || event.to === playerId;
    case 'chat_intercepted':
      return event.owner === playerId;
    case 'coast_bombarded':
      // The target's owner always hears about it; others only if they can see the coast.
      return visible.has(event.provinceId);
    case 'army_arrived':
    case 'army_landed':
    case 'army_destroyed':
    case 'recruit_completed':
    case 'recruit_cancelled':
    case 'building_completed':
    case 'building_cancelled':
      return visible.has(event.provinceId);
    default:
      return true;
  }
}

/**
 * The chats a player can read: their own, in full (and without the marks of who listened), and the
 * messages of other people's chats that a spy of their team intercepted.
 */
function visibleChats(chats: Chat[], playerId: PlayerId, team: ReadonlySet<PlayerId>): Chat[] {
  const result: Chat[] = [];
  for (const chat of chats) {
    if (chat.participants.includes(playerId)) {
      result.push({ ...chat, messages: chat.messages.map(({ interceptedBy: _hidden, ...message }) => message) });
      continue;
    }
    const heard = chat.messages.filter((m) => m.interceptedBy?.some((owner) => team.has(owner)));
    if (heard.length > 0) result.push({ ...chat, messages: heard });
  }
  return result;
}

/**
 * The game as `playerId` knows it. Pure function: the real state is never modified.
 * Pass the memory of the previous view to keep the last known buildings and morale of
 * provinces that have gone out of sight.
 */
export function viewFor(state: GameState, rules: Ruleset, playerId: PlayerId, previous: MemoryMap = {}): PlayerView {
  const visibleSet = visibleProvinces(state, rules, playerId);
  const team = new Set(visionTeam(state, playerId));

  const memory: MemoryMap = { ...previous };
  for (const province of state.provinces) {
    if (visibleSet.has(province.id)) {
      memory[province.id] = {
        tick: state.tick,
        buildings: [...province.buildings],
        ...(province.buildingLevels ? { buildingLevels: { ...province.buildingLevels } } : {}),
        morale: province.morale,
      };
    }
  }

  const view = structuredClone(state);
  // Secret agents stay secret even without fog: you only know your own team's spies.
  view.spies = view.spies.filter((s) => team.has(s.owner));
  const spied = spiedProvinces(state, team);
  const spiedOwners = new Set(
    state.provinces.filter((p) => spied.has(p.id) && p.owner !== null).map((p) => p.owner as PlayerId),
  );
  if (rules.vision.fog) {
    // Stealth armies (submarines) are only seen from close by, even inside a province in sight.
    const close = stealthSeen(state, rules, team);
    view.armies = view.armies.filter(
      (a) =>
        team.has(a.owner) || (visibleSet.has(a.location) && (!isStealthy(rules, a.units) || close.has(a.location))),
    );

    for (const province of view.provinces) {
      if (visibleSet.has(province.id)) continue;
      const known = memory[province.id];
      province.buildings = known ? [...known.buildings] : [];
      if (known?.buildingLevels) province.buildingLevels = { ...known.buildingLevels };
      else delete province.buildingLevels;
      province.morale = known ? known.morale : rules.morale.start;
    }

    for (const player of view.players) {
      if (!team.has(player.id) && !spiedOwners.has(player.id)) player.stockpile = {};
    }
    view.recruitQueue = view.recruitQueue.filter((j) => team.has(j.owner) || spied.has(j.provinceId));
    view.constructionQueue = view.constructionQueue.filter((j) => team.has(j.owner) || spied.has(j.provinceId));
  }
  // Offers, deals and talks are private, with or without fog.
  view.proposals = view.proposals.filter((p) => p.from === playerId || p.to === playerId);
  view.trades = view.trades.filter((t) => t.from === playerId || t.to === playerId);
  view.chats = visibleChats(view.chats, playerId, team);
  view.events = view.events.filter((e) => isEventVisible(e, visibleSet, playerId));
  // The victim of a sabotage sees the damage, not the culprit.
  view.events = view.events.map((e) =>
    (e.type === 'building_sabotaged' || e.type === 'morale_sabotaged') && e.by !== null && !team.has(e.by)
      ? { ...e, by: null }
      : e,
  );

  return { state: view, visible: [...visibleSet].sort(), memory };
}
