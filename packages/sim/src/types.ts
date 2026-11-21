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
}

export interface CombatRules {
  /** Global multiplier applied to all damage. Use it to tune battle length. */
  damageScale: number;
  /** A side whose total unit count drops below this value is wiped out. */
  minUnitsAlive: number;
}

export interface VictoryRules {
  /**
   * Domination: a player wins by owning at least this share of ALL provinces
   * (neutral ones included). Must be in (0.5, 1], so two players cannot both reach it.
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

export interface DiplomacyRules {
  /** How long a truce lasts, in ticks. When it ends the two players are at war again. */
  truceTicks: number;
  /** Ticks between declaring war on a truce partner or an ally and the war starting. 0 = immediately. */
  warNoticeTicks: number;
  /** A proposal nobody answers is withdrawn after this many ticks. */
  proposalTicks: number;
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
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export interface ProvinceDef {
  id: ProvinceId;
  name: string;
  /** Resource produced by the province (single resource per province for now). */
  resource: ResourceId;
  /** Amount produced per tick while the province has an owner. */
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
  /** Counter used to generate deterministic ids (jobs, new armies, proposals). */
  nextId: number;
  /** Players with no provinces, armies or recruit batches left. Never shrinks. */
  eliminated: PlayerId[];
  /** Set once the game is decided. A finished game no longer advances. */
  outcome: GameOutcome | null;
  /** Events produced by the last tick only. Handy for UI and logs. */
  events: GameEvent[];
}
