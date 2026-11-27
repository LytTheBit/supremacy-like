import {
  areHostile,
  baseRuleset,
  combatUnits,
  damageReduction,
  buildOrganicShapes,
  createSkirmish,
  generateHexMap,
  hexMapBounds,
  hexToPixel,
  isEventVisible,
  makeEdgeDistance,
  moraleProductionFactor,
  orderBuild,
  isSeaProvince,
  orderCancelTrade,
  orderDeclareWar,
  orderGift,
  orderOfferTrade,
  orderRespondTrade,
  orderSendMessage,
  provinceMoneyIncome,
  currencyOf,
  orderDisembark,
  orderEmbark,
  orderHoldFire,
  orderMarketAccept,
  orderMarketCancel,
  orderMarketOffer,
  orderMove,
  orderPropose,
  orderRecruit,
  orderRespond,
  orderRecallSpy,
  orderSpy,
  orderSpyMission,
  orderStop,
  previewBattle,
  productionMultiplier,
  provinceAnchors,
  rulesetWithMedals,
  runAi,
  sumUnits,
  tick,
  toMapDef,
  viewFor,
  type BattlePreview,
  type Bundle,
  type GameState,
  type HexMapBounds,
  type HexMapData,
  type MapDef,
  type MedalId,
  type MemoryMap,
  type OrganicShapes,
  type Point,
  type ProvinceId,
  type ResourceId,
  type Ruleset,
  type SpyMissionRequest,
  type TreatyKind,
} from '@supremacy/sim';
import { t } from './i18n';
import { describeEvent, type LogEntry } from './log';
import { provinceNames } from './names';

/** Pixel size of one hex (center to corner) in the map view. */
export const HEX_SIZE = 12;
export const HUMAN_ID = 'red';
export const AI_IDS: string[] = ['blue'];
export const MAX_LOG = 120;

export interface SessionOptions {
  seed: number;
  provinces: number;
  medals: MedalId[];
  /** Organic border strength, 0..1. Only changes how the map is drawn. */
  organic: number;
  /** Fog of war. Default true. */
  fog?: boolean;
  /** Carve sea provinces out of the water: ships, ports and landings. Default false. */
  sea?: boolean;
}

export interface Snapshot {
  /** Changes on every update: lets React detect changes cheaply. */
  version: number;
  /** The game as the player knows it: with the fog of war applied, this is NOT the real state. */
  state: GameState;
  /** Provinces in sight right now (all of them without fog). */
  visible: ProvinceId[];
  /** Ticks per second. 0 means paused. */
  speed: number;
  log: LogEntry[];
  /** Per chat: the number of the newest message the player has read (see `messageNumber`). */
  chatRead: Record<string, number>;
}

export type OrderOutcome = { ok: true } | { ok: false; error: string };

type RawResult = { ok: true; state: GameState } | { ok: false; error: string };

/**
 * Everything the interface needs, without any React: a generated map, a ruleset, the game
 * state, the AI opponent and the player's orders. The interface only reads snapshots
 * and calls the methods below.
 *
 * The real state (`truth`) never leaves this class: snapshots carry the player's view of it,
 * with the fog of war applied, so the interface cannot show what the player should not see.
 */
export class GameSession {
  readonly options: SessionOptions;
  readonly rules: Ruleset;
  readonly hexMap: HexMapData;
  readonly mapDef: MapDef;
  readonly shapes: OrganicShapes;
  readonly bounds: HexMapBounds;
  /** Pixel position of each province's anchor (label and army marker). */
  readonly anchors: Record<ProvinceId, Point>;
  readonly edgeDistance: (a: ProvinceId, b: ProvinceId) => number | undefined;

  /** What each province is called: a proper noun, or a number to show as "Sea 3" / "Province 41" in the current language. */
  private readonly names: Record<ProvinceId, string | { kind: 'sea' | 'province'; n: number }>;
  private truth: GameState;
  private lastSeen: MemoryMap = {};
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private logCounter = 0;
  private activeBattles = new Set<ProvinceId>();

  constructor(options: SessionOptions) {
    this.options = options;
    const base = rulesetWithMedals(baseRuleset, options.medals);
    this.rules = { ...base, vision: { ...base.vision, fog: options.fog ?? true } };

    const hexMap = generateHexMap({
      seed: options.seed,
      width: 44,
      height: 30,
      provinceCount: options.provinces,
      seaProvinceCount: options.sea ? Math.max(4, Math.round(options.provinces / 3)) : 0,
    });
    const landProvinces = hexMap.provinces.filter((p) => !isSeaProvince(p));
    const generated = provinceNames(landProvinces.length, options.seed);
    this.names = {};
    landProvinces.forEach((province, i) => {
      this.names[province.id] = generated[i] ?? { kind: 'province', n: i + 1 };
    });
    hexMap.provinces
      .filter((p) => isSeaProvince(p))
      .forEach((province, i) => {
        this.names[province.id] = { kind: 'sea', n: i + 1 };
      });
    this.hexMap = hexMap;
    this.mapDef = toMapDef(hexMap);
    this.edgeDistance = makeEdgeDistance(this.mapDef.edges);

    this.shapes = buildOrganicShapes(hexMap, { strength: options.organic, seed: options.seed, size: HEX_SIZE });
    this.bounds = hexMapBounds(hexMap, HEX_SIZE, HEX_SIZE * 1.6);
    this.anchors = {};
    for (const [id, hex] of provinceAnchors(hexMap)) this.anchors[id] = hexToPixel(hex, HEX_SIZE);

    this.truth = createSkirmish(hexMap, this.mapDef, this.rules, {
      // English names for the data; the interface shows them translated (`player.<id>`).
      players: [
        { id: HUMAN_ID, name: 'Red Empire' },
        { id: 'blue', name: 'Blue Republic' },
      ],
    });
    const view = viewFor(this.truth, this.rules, HUMAN_ID);
    this.lastSeen = view.memory;
    this.snapshot = { version: 0, state: view.state, visible: view.visible, speed: 0, log: [], chatRead: {} };
  }

  /** The name of a province in the current language. */
  provinceName(id: ProvinceId): string {
    const name = this.names[id];
    if (name === undefined) return id;
    if (typeof name === 'string') return name;
    return t(name.kind === 'sea' ? 'map.sea' : 'map.province', { n: name.n });
  }

  // --- React integration (useSyncExternalStore) -------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  // --- Time -----------------------------------------------------------------------------------

  setSpeed(speed: number): void {
    if (speed === this.snapshot.speed) return;
    this.update({ speed });
  }

  /** Advances the game by one tick: the AI plays first, then the world updates. */
  step(): void {
    const previous = this.truth;
    if (previous.outcome) return;

    let next = previous;
    for (const id of AI_IDS) next = runAi(next, this.rules, id);
    next = tick(next, this.rules);
    this.truth = next;

    const view = this.refreshView();
    this.update({
      state: view.state,
      visible: view.visible,
      log: this.appendLog(previous, next, new Set(view.visible)),
    });
  }

  // --- Player orders (each returns an outcome and updates the game when it works) -------

  moveArmy(armyId: string, target: ProvinceId): OrderOutcome {
    return this.apply(orderMove(this.truth, HUMAN_ID, armyId, target, this.rules));
  }

  stopArmy(armyId: string): OrderOutcome {
    return this.apply(orderStop(this.truth, HUMAN_ID, armyId));
  }

  recruit(provinceId: ProvinceId, unitType: string, count: number): OrderOutcome {
    return this.apply(orderRecruit(this.truth, this.rules, HUMAN_ID, provinceId, unitType, count));
  }

  build(provinceId: ProvinceId, buildingType: string): OrderOutcome {
    return this.apply(orderBuild(this.truth, this.rules, HUMAN_ID, provinceId, buildingType));
  }

  /** Loads a land army onto a fleet docked in the same port. */
  embark(armyId: string, fleetId: string): OrderOutcome {
    return this.apply(orderEmbark(this.truth, this.rules, HUMAN_ID, armyId, fleetId));
  }

  /** Unloads the cargo of a fleet docked in a port. */
  disembark(armyId: string): OrderOutcome {
    return this.apply(orderDisembark(this.truth, this.rules, HUMAN_ID, armyId));
  }

  /** Tells a fleet to stop (true) or start (false) shelling the coast. */
  holdFire(armyId: string, hold: boolean): OrderOutcome {
    return this.apply(orderHoldFire(this.truth, this.rules, HUMAN_ID, armyId, hold));
  }

  /** Why an order would fail right now, or null if it would work. Orders are pure, so this is a dry run. */
  checkRecruit(provinceId: ProvinceId, unitType: string, count: number): string | null {
    const result = orderRecruit(this.truth, this.rules, HUMAN_ID, provinceId, unitType, count);
    return result.ok ? null : result.error;
  }

  checkBuild(provinceId: ProvinceId, buildingType: string): string | null {
    const result = orderBuild(this.truth, this.rules, HUMAN_ID, provinceId, buildingType);
    return result.ok ? null : result.error;
  }

  // --- Espionage ---------------------------------------------------------------------------------

  /** Sends a spy to a foreign province (the cost is paid at once). */
  spy(provinceId: ProvinceId): OrderOutcome {
    return this.apply(orderSpy(this.truth, this.rules, HUMAN_ID, provinceId));
  }

  /** Gives a spy in place a mission. */
  spyMission(spyId: string, mission: SpyMissionRequest): OrderOutcome {
    return this.apply(orderSpyMission(this.truth, this.rules, HUMAN_ID, spyId, mission));
  }

  /** Calls a spy home. */
  recallSpy(spyId: string): OrderOutcome {
    return this.apply(orderRecallSpy(this.truth, HUMAN_ID, spyId));
  }

  /** Why a spy could not be sent to this province right now, or null if it could. */
  checkSpy(provinceId: ProvinceId): string | null {
    const result = orderSpy(this.truth, this.rules, HUMAN_ID, provinceId);
    return result.ok ? null : result.error;
  }

  // --- Market ------------------------------------------------------------------------------------

  /**
   * Offers `giveAmount` of a resource for `wantAmount` of another. It is paid at once and trades
   * right away with whatever crosses it; the rest stays open on the book.
   */
  marketOffer(give: ResourceId, giveAmount: number, want: ResourceId, wantAmount: number): OrderOutcome {
    return this.apply(orderMarketOffer(this.truth, this.rules, HUMAN_ID, give, giveAmount, want, wantAmount));
  }

  /** Takes an offer of another player as it stands. */
  marketAccept(orderId: string): OrderOutcome {
    return this.apply(orderMarketAccept(this.truth, this.rules, HUMAN_ID, orderId));
  }

  /** Withdraws one of the player's offers: what is left of it comes back. */
  marketCancel(orderId: string): OrderOutcome {
    return this.apply(orderMarketCancel(this.truth, HUMAN_ID, orderId));
  }

  /** Why an offer of somebody else could not be accepted right now, or null if it could. */
  checkMarketAccept(orderId: string): string | null {
    const result = orderMarketAccept(this.truth, this.rules, HUMAN_ID, orderId);
    return result.ok ? null : result.error;
  }

  // --- Chat, deals and gifts -------------------------------------------------------------------

  /** Writes to another player. */
  sendMessage(to: string, text: string): OrderOutcome {
    return this.apply(orderSendMessage(this.truth, this.rules, HUMAN_ID, to, text));
  }

  /** Offers a deal: the player gives `give` and asks `to` for `want`. */
  offerTrade(to: string, give: Bundle, want: Bundle): OrderOutcome {
    return this.apply(orderOfferTrade(this.truth, this.rules, HUMAN_ID, to, give, want));
  }

  /** Accepts or rejects a deal offered to the player. */
  respondTrade(tradeId: string, accept: boolean): OrderOutcome {
    return this.apply(orderRespondTrade(this.truth, this.rules, HUMAN_ID, tradeId, accept));
  }

  /** Withdraws a deal the player offered. */
  cancelTrade(tradeId: string): OrderOutcome {
    return this.apply(orderCancelTrade(this.truth, HUMAN_ID, tradeId));
  }

  /** Gives something to another player: it arrives at once. */
  gift(to: string, give: Bundle): OrderOutcome {
    return this.apply(orderGift(this.truth, this.rules, HUMAN_ID, to, give));
  }

  /** Why accepting a deal would fail right now, or null if it would work. */
  checkRespondTrade(tradeId: string): string | null {
    const result = orderRespondTrade(this.truth, this.rules, HUMAN_ID, tradeId, true);
    return result.ok ? null : result.error;
  }

  /** The player has read a chat up to this message number: nothing newer than it counts as unread. */
  markChatRead(chatId: string, upTo: number): void {
    if ((this.snapshot.chatRead[chatId] ?? 0) >= upTo) return;
    this.update({ chatRead: { ...this.snapshot.chatRead, [chatId]: upTo } });
  }

  // --- Diplomacy ---------------------------------------------------------------------------------

  /** Offers a truce or an alliance to another player. The AI answers on its next turn. */
  propose(target: string, kind: TreatyKind): OrderOutcome {
    return this.apply(orderPropose(this.truth, this.rules, HUMAN_ID, target, kind));
  }

  /** Accepts or rejects an offer made to the player. */
  respond(proposalId: string, accept: boolean): OrderOutcome {
    return this.apply(orderRespond(this.truth, this.rules, HUMAN_ID, proposalId, accept));
  }

  /** Declares war on a truce partner or an ally (it starts after the notice). */
  declareWar(target: string): OrderOutcome {
    return this.apply(orderDeclareWar(this.truth, this.rules, HUMAN_ID, target));
  }

  /** Predicted outcome of attacking a province with an army, or null if nobody defends it. */
  previewAttack(armyId: string, target: ProvinceId): BattlePreview | null {
    const { state } = this.snapshot;
    const army = state.armies.find((a) => a.id === armyId);
    if (!army) return null;
    const defenders = state.armies.filter((a) => a.location === target && areHostile(state, army.owner, a.owner));
    if (defenders.length === 0) return null;
    // At sea only the ships fight: cargo does not count.
    const place = state.provinces.find((p) => p.id === target);
    const atSea = place !== undefined && isSeaProvince(place);
    // The fortress of the province stops part of the damage the defenders take (on land only).
    const shield = place && !atSea && place.owner !== null && areHostile(state, army.owner, place.owner)
      ? 1 - damageReduction(this.rules, place)
      : 1;
    return previewBattle(
      this.rules,
      combatUnits(this.rules, army.units, atSea),
      combatUnits(this.rules, sumUnits(defenders.map((a) => a.units)), atSea),
      1000,
      shield,
    );
  }

  // --- Internals ---------------------------------------------------------------------------------

  private apply(result: RawResult): OrderOutcome {
    if (!result.ok) return { ok: false, error: result.error };
    this.truth = result.state;
    const view = this.refreshView();
    this.update({ state: view.state, visible: view.visible });
    return { ok: true };
  }

  /** The player's view of the real state, remembering what was seen of provinces now out of sight. */
  private refreshView() {
    const view = viewFor(this.truth, this.rules, HUMAN_ID, this.lastSeen);
    this.lastSeen = view.memory;
    return view;
  }

  private update(patch: Partial<Omit<Snapshot, 'version'>>): void {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 };
    for (const listener of [...this.listeners]) listener();
  }

  private appendLog(previous: GameState, next: GameState, visible: ReadonlySet<ProvinceId>): LogEntry[] {
    const lines: Omit<LogEntry, 'id'>[] = []; // `text` is a function: it is evaluated when shown, so a language change reaches old lines too
    // The log only tells what the player could see.
    const events = next.events.filter((event) => isEventVisible(event, visible, HUMAN_ID));
    const ctx = {
      rules: this.rules,
      placeName: (id: ProvinceId) => this.provinceName(id),
      humanId: HUMAN_ID,
      previous,
      next,
    };

    // A battle lasts several ticks: log it once, when it starts.
    const battles = new Set<ProvinceId>();
    for (const event of events) {
      if (event.type === 'battle') {
        battles.add(event.provinceId);
        if (!this.activeBattles.has(event.provinceId)) {
          const involvesUs = event.owners.includes(HUMAN_ID);
          const provinceId = event.provinceId;
          lines.push({
            tick: next.tick,
            tone: involvesUs ? 'bad' : 'info',
            text: () => t('log.battle', { place: this.provinceName(provinceId) }),
          });
        }
      }
    }
    this.activeBattles = battles;

    for (const event of events) {
      const line = describeEvent(event, ctx);
      if (line) lines.push({ tick: next.tick, ...line });
    }

    if (lines.length === 0) return this.snapshot.log;
    const entries = lines.map((line) => ({ id: ++this.logCounter, ...line }));
    return [...this.snapshot.log, ...entries].slice(-MAX_LOG);
  }
}

/** Resources produced per tick by a player's provinces, with building and morale effects. */
export function incomePerTick(state: GameState, rules: Ruleset, playerId: string): Record<ResourceId, number> {
  const income: Record<ResourceId, number> = Object.fromEntries(rules.resources.map((r) => [r, 0]));
  for (const province of state.provinces) {
    if (province.owner !== playerId || isSeaProvince(province)) continue;
    const produced =
      province.production * productionMultiplier(rules, province) * moraleProductionFactor(rules, province);
    income[province.resource] = (income[province.resource] ?? 0) + produced;
    const currency = currencyOf(rules);
    if (currency !== null) income[currency] = (income[currency] ?? 0) + provinceMoneyIncome(rules, province);
  }
  return income;
}
