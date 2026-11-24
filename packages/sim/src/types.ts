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
  /** Counter used to generate deterministic ids (jobs, new armies, proposals, spies). */
  nextId: number;
  /** Players with no provinces, armies or recruit batches left. Never shrinks. */
  eliminated: PlayerId[];
  /** Set once the game is decided. A finished game no longer advances. */
  outcome: GameOutcome | null;
  /** Events produced by the last tick only. Handy for UI and logs. */
  events: GameEvent[];
}
