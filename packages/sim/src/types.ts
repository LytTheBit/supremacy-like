/**
 * Core types of the simulation.
 *
 * Design rules:
 * - Everything here is plain JSON-serializable data (no classes, no Maps),
 *   so the state can be sent over the network, saved, and compared in tests.
 * - Static game data (units, resources) lives in a Ruleset, not in the code.
 */

export type PlayerId = string;
export type ProvinceId = string;
export type ArmyId = string;
export type ResourceId = string;
export type UnitTypeId = string;
export type BuildingId = string;
export type MedalId = string;

/** A province is either land (owned, produces resources) or sea (never owned, only crossed by ships). */
export type Terrain = 'land' | 'sea';
/**
 * Where a unit operates. Land units walk on land; sea units sail and dock in ports; air units
 * fly over everything but must stay within `range` of an airbase.
 */
export type UnitDomain = 'land' | 'sea' | 'air';

/** Unit counts by type. Counts are fractional: casualties scale armies smoothly. */
export type Units = Record<UnitTypeId, number>;

// ---------------------------------------------------------------------------
// Ruleset (static data, composed from base + era + medals in the future)
// ---------------------------------------------------------------------------

export interface UnitDef {
  name: string;
  attack: number;
  defense: number;
  /** Hit points of a single unit. */
  hp: number;
  /** Distance covered per tick on the province graph. */
  speed: number;
  /** Resources paid for ONE unit when recruiting. */
  cost: Record<ResourceId, number>;
  /** Ticks needed to train a batch (the whole batch trains in parallel). */
  trainingTicks: number;
  /** Building that must exist in the province to train this unit. Omit for no requirement. */
  requires?: BuildingId;
  /**
   * Makes this unit a commander. Commanders do not fight themselves: each one raises the
   * attack and defense of the other troops of its army by `bonus` (0.02 = +2%), and all
   * commanders of this type together never give more than `maxBonus`.
   */
  commander?: { bonus: number; maxBonus: number };
  /** How far this unit sees (travel distance). Omit to use `rules.vision.unitRadius`. */
  vision?: number;
  /** Land (default), sea or air. Sea units can only be in sea provinces or docked in a port. */
  domain?: UnitDomain;
  /**
   * Air units only: how far from the nearest airbase of their owner (or an ally), as travel
   * distance, the unit can fly. An army is limited by its shortest-range unit.
   */
  range?: number;
  /**
   * Attack multiplier against targets of each domain (default 1). The multiplier of a unit
   * applies in proportion to how many of the enemy's units belong to that domain, so
   * bombers hurt ground troops and ships but fighters beat bombers.
   */
  vs?: Partial<Record<UnitDomain, number>>;
  /**
   * Sea units only: attack used to shell enemy armies on an adjacent coast. Optional: ships
   * without it (submarines, transports) never bombard. Shelling is one-sided: the troops on
   * land cannot fire back.
   */
  bombard?: number;
  /**
   * Sea units only: how many land units one of them carries. An army with land units in a sea
   * province must have enough capacity for all of them. Cargo does not fight at sea, but it is
   * lost together with the ships.
   */
  capacity?: number;
}

export interface BuildingDef {
  name: string;
  /** Resources paid when the construction is ordered. */
  cost: Record<ResourceId, number>;
  /** Ticks needed to build it. */
  buildTicks: number;
  /** Multiplies the production of the province it stands in. Default 1. */
  productionMultiplier?: number;
  /** Multiplies the training time of units trained in the province. Default 1. */
  trainingTimeMultiplier?: number;
  /** Can only be built in a land province that borders the sea. */
  coastal?: boolean;
  /** Ships can dock in a province that has this building (its owner's and allies' ships). */
  harbor?: boolean;
  /** Aircraft can be based here (its owner's and allies'); they measure their range from it. */
  airbase?: boolean;
}

export interface CombatRules {
  /** Global multiplier applied to all damage. Use it to tune battle length. */
  damageScale: number;
  /** A side whose total unit count drops below this value is wiped out. */
  minUnitsAlive: number;
}

export interface VictoryRules {
  /**
   * Domination: a player wins by owning at least this share of ALL land provinces
   * (neutral ones included, sea provinces not counted). Must be in (0.5, 1], so two players
   * cannot both reach it.
   */
  provinceShare: number;
}

export interface MoraleRules {
  /** Morale of every province at the start of the game, 0..100. */
  start: number;
  /** Morale of a province right after it is conquered, 0..100. */
  afterConquest: number;
  /** Morale regained per tick by owned provinces, up to 100. */
  recoveryPerTick: number;
  /** Production factor at morale 0. At morale 100 the factor is 1. */
  minProductionFactor: number;
  /** Troops can only be trained in provinces with at least this morale. */
  minToRecruit: number;
}

export interface CommanderRules {
  /** Commanders only improve this many troops of an army (the rest fights without the bonus). Omit for no limit. */
  maxAffectedTroops?: number;
}

export interface VisionRules {
  /** Fog of war: you only see armies, buildings and morale inside your vision. false = see everything. */
  fog: boolean;
  /** How far an owned province sees, as travel distance along the links between provinces. */
  provinceRadius: number;
  /** How far an army sees when none of its units says otherwise (UnitDef.vision). */
  unitRadius: number;
}

export interface DiplomacyRules {
  /** How long a truce lasts, in ticks. When it ends the two players are at war again. */
  truceTicks: number;
  /** Ticks between declaring war on a truce partner or an ally and the war starting. 0 = immediately. */
  warNoticeTicks: number;
  /** A proposal nobody answers is withdrawn after this many ticks. */
  proposalTicks: number;
}

export interface EspionageRules {
  /** Resources paid to send one spy. */
  cost: Record<ResourceId, number>;
  /** Most spies a player can have at once (the ones still travelling count too). */
  maxSpies: number;
  /** Ticks a spy needs to get into place in the target province. */
  infiltrateTicks: number;
  /** Ticks a spy survives once in place before the cover is blown (the mission must finish before). */
  coverTicks: number;
  /** Sabotage: destroys one building of the province. The spy leaves when it is done. */
  sabotage: { ticks: number };
  /** Disinformation: lowers the morale of the province by `moraleDamage`. The spy leaves when it is done. */
  disinformation: { ticks: number; moraleDamage: number };
  /**
   * Wiretapping: when a spy gets into place it also reads this many of the latest messages of every
   * chat the owner of the province takes part in (the context of the conversation). Default 6.
   */
  chatContext?: number;
}

/** Money: a resource like the others (it is in `Ruleset.resources`), but every owned province earns it. */
export interface EconomyRules {
  /** The resource that is money. It must be listed in `Ruleset.resources`. */
  currency: ResourceId;
  /** Money earned per tick by each owned land province, before the morale factor. */
  incomePerProvince: number;
}

/** Talking and dealing between players. */
export interface ChatRules {
  /** Messages kept per chat. When it is full the oldest ones are dropped. */
  maxMessages: number;
  /** Longest text of a message, in characters. */
  maxTextLength: number;
  /** Most trade offers a player can have open at once. */
  maxOpenTrades: number;
}

export interface MarketRules {
  /** Most open orders a player can have on the market at once. */
  maxOrders: number;
  /** Ticks an order stays open. When it runs out, what is left of it goes back to its owner. */
  orderTicks: number;
  /**
   * Smallest amount of the offered resource an order can have. A leftover below it (after a
   * partial trade) is not kept on the book: it goes back to its owner.
   */
  minAmount: number;
}

export interface Ruleset {
  id: string;
  /** Historical era this ruleset describes. */
  era: string;
  /** Medals added when the game was created. Medals cannot change during a game. */
  medals: MedalId[];
  resources: ResourceId[];
  units: Record<UnitTypeId, UnitDef>;
  buildings: Record<BuildingId, BuildingDef>;
  combat: CombatRules;
  commanders?: CommanderRules;
  morale: MoraleRules;
  victory: VictoryRules;
  diplomacy: DiplomacyRules;
  vision: VisionRules;
  /** Spies. Omit to play without espionage (the orders then fail with `espionage_unavailable`). */
  espionage?: EspionageRules;
  /** Resource market between players. Omit to play without it (the orders then fail with `market_unavailable`). */
  market?: MarketRules;
  /** Money. Omit to play without a currency (no income; resources are only bartered). */
  economy?: EconomyRules;
  /** Chat limits. Omit for the defaults (see `chatRules()`). */
  chat?: ChatRules;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export interface ProvinceDef {
  id: ProvinceId;
  name: string;
  /** Land (default) or sea. Sea provinces have no owner, no buildings and produce nothing. */
  terrain?: Terrain;
  /** Resource produced by the province (single resource per province for now). Unused at sea. */
  resource: ResourceId;
  /** Amount produced per tick while the province has an owner. Always 0 at sea. */
  production: number;
}

/** Undirected link between two adjacent provinces. */
export interface Edge {
  a: ProvinceId;
  b: ProvinceId;
  distance: number;
}

export interface MapDef {
  id: string;
  provinces: ProvinceDef[];
  edges: Edge[];
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface Player {
  id: PlayerId;
  name: string;
  stockpile: Record<ResourceId, number>;
}

export interface Province extends ProvinceDef {
  owner: PlayerId | null;
  /** Completed buildings (at most one of each type). They stay when the province is conquered. */
  buildings: BuildingId[];
  /** 0..100. Low morale reduces production and blocks recruitment. */
  morale: number;
}

/** A movement order along the province graph. */
export interface MoveOrder {
  /** Remaining provinces to visit, in order. Excludes the current location. */
  path: ProvinceId[];
  /** Distance already covered on the edge towards path[0]. */
  progress: number;
}

export interface Army {
  id: ArmyId;
  owner: PlayerId;
  location: ProvinceId;
  units: Units;
  order: MoveOrder | null;
  /** Fleets only: when true the ships do not shell the coast. Default false (they fire). */
  holdFire?: boolean;
}

/** A batch of units being trained in a province. */
export interface RecruitJob {
  id: string;
  owner: PlayerId;
  provinceId: ProvinceId;
  unitType: UnitTypeId;
  count: number;
  ticksLeft: number;
}

/** A building under construction. */
export interface ConstructionJob {
  id: string;
  owner: PlayerId;
  provinceId: ProvinceId;
  buildingType: BuildingId;
  ticksLeft: number;
}

/** Treaty between two players. Two players with no treaty are at war. */
export type TreatyKind = 'truce' | 'alliance';
export type RelationStatus = 'war' | TreatyKind;

/**
 * A treaty in force. The pair is stored sorted (a < b). Only treaties are stored: a pair
 * that is not listed is at war, which is how every game starts.
 */
export interface Relationship {
  a: PlayerId;
  b: PlayerId;
  kind: TreatyKind;
  /** Tick at which a truce runs out (and the war resumes). Alliances never expire. */
  until?: number;
  /** Set when one side has declared war: the treaty ends at this tick. */
  warAt?: number;
}

/** An offer from one player to another, waiting for an answer. */
export interface Proposal {
  id: string;
  from: PlayerId;
  to: PlayerId;
  kind: TreatyKind;
  /** The proposal is withdrawn at this tick. */
  expiresAt: number;
}

/** Things that change hands in a deal: resources (money included) and whole provinces. */
export interface Bundle {
  resources: Record<ResourceId, number>;
  provinces: ProvinceId[];
}

/**
 * A deal offered to one player: `from` hands over `give` and asks `to` for `want`. Nothing is held
 * back while the offer is open: everything is checked again when it is accepted.
 */
export interface Trade {
  id: string;
  from: PlayerId;
  to: PlayerId;
  give: Bundle;
  want: Bundle;
  /** The offer is withdrawn at this tick. */
  expiresAt: number;
}

export type OfferStatus = 'open' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

/** What a chat message holds. Offers are cards in the conversation: their status follows the offer. */
export type ChatContent =
  | { kind: 'text'; text: string }
  | { kind: 'treaty'; proposalId: string; treaty: TreatyKind; status: OfferStatus }
  | { kind: 'trade'; tradeId: string; give: Bundle; want: Bundle; status: OfferStatus }
  /** A gift: already delivered, nothing to answer. */
  | { kind: 'gift'; give: Bundle }
  /** Told by the game itself (`from` is null), except `war_declared`, which the declaring player "says". */
  | { kind: 'notice'; notice: 'war_declared' | 'war_started' | 'truce_expired'; warAt?: number };

export interface ChatMessage {
  id: string;
  tick: number;
  /** The sender, or null for a notice of the game. */
  from: PlayerId | null;
  content: ChatContent;
  /**
   * Players whose spies read this message. Never shown to the people in the chat: `viewFor` removes
   * it from their own chats.
   */
  interceptedBy?: PlayerId[];
}

/**
 * A conversation. Today every chat is `direct` (exactly two players, created when they first talk);
 * `group` chats (alliances, coalitions) use the same shape with more participants.
 */
export interface Chat {
  id: string;
  kind: 'direct' | 'group';
  /** Sorted player ids. */
  participants: PlayerId[];
  /** Oldest first. */
  messages: ChatMessage[];
}

/** What a spy in place is busy with. A spy with no mission only watches. */
export type SpyMission =
  | { kind: 'sabotage'; buildingType: BuildingId; ticksLeft: number }
  | { kind: 'disinformation'; ticksLeft: number };

/** The mission a player asks for (the ticks come from the ruleset). */
export type SpyMissionRequest = { kind: 'sabotage'; buildingType: BuildingId } | { kind: 'disinformation' };

/** A secret agent in a foreign province. Nobody but its owner (and the owner's allies' view) knows it is there. */
export interface Spy {
  id: string;
  owner: PlayerId;
  provinceId: ProvinceId;
  /** Ticks before the spy is in place. 0 = in place: it sees the province and can start a mission. */
  infiltrationLeft: number;
  /** Ticks before the cover is blown. Only counts down once the spy is in place. */
  coverLeft: number;
  mission: SpyMission | null;
}

/** An amount of one resource. */
export interface MarketAmount {
  resource: ResourceId;
  amount: number;
}

/**
 * An offer on the market: the owner gives `give` and wants `want` in return. What is offered is
 * taken out of the owner's stockpile when the order is placed and held here until it is traded,
 * cancelled or expired. Both amounts are what is LEFT: a partial trade shrinks them in the same
 * proportion, so the price (`want.amount / give.amount`) never changes while an order is open.
 */
export interface MarketOrder {
  id: string;
  owner: PlayerId;
  give: MarketAmount;
  want: MarketAmount;
  /** The order expires at this tick. */
  expiresAt: number;
}

/** Why a spy is gone. */
export type SpyRemovedReason = 'mission_done' | 'cover_blown' | 'target_changed' | 'recalled';

export type VictoryReason = 'domination' | 'last_standing' | 'extinction' | 'coalition';

/**
 * Final result of a finished game. `winners` lists everyone who won (several players when a
 * coalition of allies wins together, empty only for mutual extinction); `winner` is the first
 * of them, or null for extinction.
 */
export interface GameOutcome {
  winner: PlayerId | null;
  winners: PlayerId[];
  reason: VictoryReason;
}

export type GameEvent =
  | { tick: number; type: 'army_arrived'; armyId: ArmyId; provinceId: ProvinceId }
  /** A fleet at sea shelled the enemy armies in the coastal province `provinceId`. */
  | { tick: number; type: 'coast_bombarded'; armyId: ArmyId; provinceId: ProvinceId }
  /** A fleet landed its troops: `armyId` is now on land, the ships stayed at sea as `fleetId`. */
  | { tick: number; type: 'army_landed'; armyId: ArmyId; fleetId: ArmyId; provinceId: ProvinceId }
  | {
      tick: number;
      type: 'recruit_completed';
      jobId: string;
      armyId: ArmyId;
      provinceId: ProvinceId;
      unitType: UnitTypeId;
      count: number;
    }
  | { tick: number; type: 'recruit_cancelled'; jobId: string; provinceId: ProvinceId }
  | { tick: number; type: 'building_completed'; provinceId: ProvinceId; buildingType: BuildingId }
  | { tick: number; type: 'building_cancelled'; jobId: string; provinceId: ProvinceId; buildingType: BuildingId }
  | { tick: number; type: 'player_eliminated'; playerId: PlayerId }
  | { tick: number; type: 'game_over'; winner: PlayerId | null; winners: PlayerId[]; reason: VictoryReason }
  | { tick: number; type: 'proposal_made'; proposalId: string; from: PlayerId; to: PlayerId; kind: TreatyKind }
  | { tick: number; type: 'proposal_accepted'; proposalId: string; from: PlayerId; to: PlayerId; kind: TreatyKind }
  | { tick: number; type: 'proposal_rejected'; proposalId: string; from: PlayerId; to: PlayerId; kind: TreatyKind }
  | { tick: number; type: 'proposal_expired'; proposalId: string; from: PlayerId; to: PlayerId; kind: TreatyKind }
  | { tick: number; type: 'war_declared'; from: PlayerId; to: PlayerId; warAt: number }
  | { tick: number; type: 'relation_changed'; a: PlayerId; b: PlayerId; status: RelationStatus; reason: 'treaty' | 'declared' | 'expired' }
  | { tick: number; type: 'battle'; provinceId: ProvinceId; owners: PlayerId[] }
  /** A spy got into place. Only its owner hears about it. */
  | { tick: number; type: 'spy_in_place'; spyId: string; owner: PlayerId; provinceId: ProvinceId }
  /**
   * A spy is gone. Its owner always hears about it; the owner of the province (`target`) only when the
   * cover was blown. A spy that finished its mission is not a loss: the event just says it came home.
   */
  | {
      tick: number;
      type: 'spy_removed';
      spyId: string;
      owner: PlayerId;
      provinceId: ProvinceId;
      target: PlayerId | null;
      reason: SpyRemovedReason;
    }
  /** A spy destroyed a building. `by` is hidden (null) in the view of the victim, who only sees the damage. */
  | {
      tick: number;
      type: 'building_sabotaged';
      provinceId: ProvinceId;
      buildingType: BuildingId;
      by: PlayerId | null;
      target: PlayerId;
    }
  /** A spy hurt the morale of a province. `by` is hidden (null) in the view of the victim. */
  | {
      tick: number;
      type: 'morale_sabotaged';
      provinceId: ProvinceId;
      damage: number;
      by: PlayerId | null;
      target: PlayerId;
    }
  /** The mission of a spy came to nothing (the building was already gone). The spy goes on watching. */
  | { tick: number; type: 'spy_mission_failed'; spyId: string; owner: PlayerId; provinceId: ProvinceId }
  /**
   * A trade on the market, told to the owner of one of the two orders (each side gets its own
   * event): they gave `gave` and got `got`. `filled` is true when the order is complete.
   */
  | { tick: number; type: 'market_trade'; orderId: string; owner: PlayerId; gave: MarketAmount; got: MarketAmount; filled: boolean }
  /** An order ran out of time: `refund` (what was left of the offer) is back in the owner's stockpile. */
  | { tick: number; type: 'market_order_expired'; orderId: string; owner: PlayerId; refund: MarketAmount }
  /** A trade offer was made, answered, withdrawn or ran out. Private to the two players. */
  | { tick: number; type: 'trade_offered' | 'trade_accepted' | 'trade_rejected' | 'trade_cancelled' | 'trade_expired'; tradeId: string; from: PlayerId; to: PlayerId }
  /** `from` gave `give` to `to`. Private to the two players. */
  | { tick: number; type: 'gift_sent'; from: PlayerId; to: PlayerId; give: Bundle }
  /** A province changed owner by agreement (a gift or a trade), not by force. Public. */
  | { tick: number; type: 'province_transferred'; provinceId: ProvinceId; from: PlayerId; to: PlayerId }
  /** A spy of `owner` read a message of a chat between `participants`. Only `owner` hears about it. */
  | { tick: number; type: 'chat_intercepted'; owner: PlayerId; chatId: string; messageId: string; participants: PlayerId[] }
  | { tick: number; type: 'army_destroyed'; armyId: ArmyId; provinceId: ProvinceId }
  | {
      tick: number;
      type: 'province_conquered';
      provinceId: ProvinceId;
      from: PlayerId | null;
      to: PlayerId;
    };

export interface GameState {
  /** Id of the ruleset this game was created with. tick() refuses a different one. */
  rulesId: string;
  tick: number;
  players: Player[];
  provinces: Province[];
  /** Static graph copy, kept in the state so it is self-contained. */
  edges: Edge[];
  armies: Army[];
  /** Batches currently in training, in the order they were ordered. */
  recruitQueue: RecruitJob[];
  /** Buildings currently under construction, in the order they were ordered. */
  constructionQueue: ConstructionJob[];
  /** Truces and alliances in force. Pairs that are not listed are at war. */
  relations: Relationship[];
  /** Offers waiting for an answer, in the order they were made. */
  proposals: Proposal[];
  /** Spies in foreign provinces (travelling or in place), in the order they were sent. */
  spies: Spy[];
  /** Open orders on the market, in the order they were placed (older first). */
  market: MarketOrder[];
  /** Trade offers between two players waiting for an answer, in the order they were made. */
  trades: Trade[];
  /** Conversations between players (private: see `viewFor`), in the order they started. */
  chats: Chat[];
  /** Counter used to generate deterministic ids (jobs, new armies, proposals, spies, market orders). */
  nextId: number;
  /** Players with no provinces, armies or recruit batches left. Never shrinks. */
  eliminated: PlayerId[];
  /** Set once the game is decided. A finished game no longer advances. */
  outcome: GameOutcome | null;
  /** Events produced by the last tick only. Handy for UI and logs. */
  events: GameEvent[];
}
