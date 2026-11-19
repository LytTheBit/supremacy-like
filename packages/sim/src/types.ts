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

export interface Ruleset {
  id: string;
  resources: ResourceId[];
  units: Record<UnitTypeId, UnitDef>;
  combat: CombatRules;
  victory: VictoryRules;
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

export type VictoryReason = 'domination' | 'last_standing' | 'extinction';

/** Final result of a finished game. winner is null only for mutual extinction. */
export interface GameOutcome {
  winner: PlayerId | null;
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
  | { tick: number; type: 'player_eliminated'; playerId: PlayerId }
  | { tick: number; type: 'game_over'; winner: PlayerId | null; reason: VictoryReason }
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
  tick: number;
  players: Player[];
  provinces: Province[];
  /** Static graph copy, kept in the state so it is self-contained. */
  edges: Edge[];
  armies: Army[];
  /** Batches currently in training, in the order they were ordered. */
  recruitQueue: RecruitJob[];
  /** Counter used to generate deterministic ids (recruit jobs, new armies). */
  nextId: number;
  /** Players with no provinces, armies or recruit batches left. Never shrinks. */
  eliminated: PlayerId[];
  /** Set once the game is decided. A finished game no longer advances. */
  outcome: GameOutcome | null;
  /** Events produced by the last tick only. Handy for UI and logs. */
  events: GameEvent[];
}
