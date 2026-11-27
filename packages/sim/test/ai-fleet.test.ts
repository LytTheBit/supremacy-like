import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  isSeaProvince,
  runAi,
  runMatch,
  type GameState,
  type MapDef,
  type Units,
} from '../src';

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];
const rich = { wood: 300000, iron: 300000, grain: 300000, coal: 300000 };

type Army = { id: string; owner: string; location: string; units: Units };

// ---------------------------------------------------------------------------
// Air force
// ---------------------------------------------------------------------------

//   r1 -1- r2 -1- r3 -1- r4 -2- front -1- bluebase
// Red owns r1..r4 (r1 has an airfield when asked), blue owns front and bluebase.
const airMap: MapDef = {
  id: 'air-ai',
  provinces: ['r1', 'r2', 'r3', 'r4', 'front', 'bluebase'].map((id) => ({
    id,
    name: id,
    resource: 'grain',
    production: 1000,
  })),
  edges: [
    { a: 'r1', b: 'r2', distance: 1 },
    { a: 'r2', b: 'r3', distance: 1 },
    { a: 'r3', b: 'r4', distance: 1 },
    { a: 'r4', b: 'front', distance: 2 },
    { a: 'front', b: 'bluebase', distance: 1 },
  ],
};
import { withOffices } from './helpers';

const rules = { ...baseRuleset, victory: { provinceShare: 1 } };

function airGame(armies: Army[], airfield = true): GameState {
  const game = createGame({
    map: airMap,
    rules,
    players,
    owners: { r1: 'red', r2: 'red', r3: 'red', r4: 'red', front: 'blue', bluebase: 'blue' },
    armies,
    buildings: airfield
      ? [
          { provinceId: 'r4', type: 'airfield' },
          { provinceId: 'r4', type: 'barracks' },
          { provinceId: 'r4', type: 'factory' },
        ]
      : [],
  });
  game.players.find((p) => p.id === 'red')!.stockpile = { ...rich };
  return withOffices(game);
}

const blueGuard = (units: Units): Army => ({ id: 'blue-guard', owner: 'blue', location: 'front', units });
const army = (state: GameState, id: string) => state.armies.find((a) => a.id === id);

describe('AI air force', () => {
  it('builds an airfield once it has enough provinces, after the land buildings it needs', () => {
    const state = airGame([blueGuard({ infantry: 1 })], false);
    // With every other building already queued or built, the airfield is next.
    const built = airGame([blueGuard({ infantry: 1 })], false);
    for (const type of ['barracks', 'factory', 'workshop']) {
      built.provinces.find((p) => p.id === 'r4')!.buildings.push(type);
    }
    const queued = runAi(built, rules, 'red').constructionQueue.map((j) => j.buildingType);
    expect(queued).toEqual(['airfield']);
    expect(runAi(state, rules, 'red', { airForce: false }).constructionQueue.map((j) => j.buildingType)).not.toContain(
      'airfield',
    );
  });

  it('does not build an airfield while it is small', () => {
    const state = airGame([blueGuard({ infantry: 1 })], false);
    for (const type of ['barracks', 'factory', 'workshop']) {
      state.provinces.find((p) => p.id === 'r4')!.buildings.push(type);
    }
    const next = runAi(state, rules, 'red', { minProvincesForAir: 5 });
    expect(next.constructionQueue.map((j) => j.buildingType)).not.toContain('airfield');
  });

  it('trains fighters and bombers at the airfield once it has an army', () => {
    const state = airGame([
      { id: 'red-1', owner: 'red', location: 'r4', units: { infantry: 12 } },
      blueGuard({ infantry: 30 }),
    ]);
    const types = runAi(state, rules, 'red').recruitQueue.map((j) => j.unitType);
    expect(types).toContain('fighter');
    expect(types).toContain('bomber');
    const job = runAi(state, rules, 'red').recruitQueue.find((j) => j.unitType === 'bomber');
    expect(job?.provinceId).toBe('r4');
  });

  it('raids a visible enemy army that it would beat', () => {
    const state = airGame([
      { id: 'air-1', owner: 'red', location: 'r4', units: { bomber: 4 } },
      blueGuard({ infantry: 6 }),
    ]);
    const next = runAi(state, rules, 'red');
    expect(army(next, 'air-1')?.order?.path.at(-1)).toBe('front');
  });

  it('does not raid forces that would destroy it, nor with too few aircraft', () => {
    const strong = airGame([
      { id: 'air-1', owner: 'red', location: 'r4', units: { bomber: 2 } },
      blueGuard({ infantry: 60 }),
    ]);
    expect(army(runAi(strong, rules, 'red'), 'air-1')?.order).toBeNull();

    const few = airGame([
      { id: 'air-1', owner: 'red', location: 'r4', units: { bomber: 1 } },
      blueGuard({ infantry: 1 }),
    ]);
    expect(army(runAi(few, rules, 'red'), 'air-1')?.order).toBeNull();
  });

  it('flies home when it is losing a fight away from its base', () => {
    const state = airGame([
      { id: 'air-1', owner: 'red', location: 'r4', units: { bomber: 1 } },
      blueGuard({ infantry: 60 }),
    ]);
    const over = structuredClone(state);
    over.armies.find((a) => a.id === 'air-1')!.location = 'front';
    const next = runAi(over, rules, 'red');
    expect(army(next, 'air-1')?.order?.path.at(-1)).toBe('r4');
  });

  it('is deterministic and never changes its input', () => {
    const state = airGame([
      { id: 'air-1', owner: 'red', location: 'r4', units: { bomber: 4 } },
      blueGuard({ infantry: 6 }),
    ]);
    const before = JSON.stringify(state);
    const a = runAi(state, rules, 'red');
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(runAi(state, rules, 'red'))).toBe(JSON.stringify(a));
  });
});

// ---------------------------------------------------------------------------
// Navy: two islands
// ---------------------------------------------------------------------------

//   r3 -1- r2 -1- r1 -1- s1 -2- s2 -1- b1 -1- b2
// Red island (r1..r3), blue island (b1, b2), the sea between them.
const islandMap: MapDef = {
  id: 'islands',
  provinces: [
    { id: 'r1', name: 'R1', resource: 'iron', production: 3000 },
    { id: 'r2', name: 'R2', resource: 'grain', production: 2000 },
    { id: 'r3', name: 'R3', resource: 'wood', production: 2000 },
    { id: 's1', name: 'S1', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 's2', name: 'S2', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 'b1', name: 'B1', resource: 'coal', production: 1000 },
    { id: 'b2', name: 'B2', resource: 'grain', production: 1000 },
  ],
  edges: [
    { a: 'r1', b: 'r2', distance: 1 },
    { a: 'r2', b: 'r3', distance: 1 },
    { a: 'r1', b: 's1', distance: 1 },
    { a: 's1', b: 's2', distance: 2 },
    { a: 's2', b: 'b1', distance: 1 },
    { a: 'b1', b: 'b2', distance: 1 },
  ],
};

function islands(extra: { blueGuard?: number } = {}): GameState {
  const game = createGame({
    map: islandMap,
    rules,
    players,
    owners: { r1: 'red', r2: 'red', r3: 'red', b1: 'blue', b2: 'blue' },
    armies: [
      { id: 'red-1', owner: 'red', location: 'r3', units: { infantry: 10 } },
      { id: 'blue-1', owner: 'blue', location: 'b1', units: { infantry: extra.blueGuard ?? 2 } },
    ],
    buildings: [
      { provinceId: 'r2', type: 'barracks' },
      { provinceId: 'r2', type: 'factory' },
    ],
  });
  game.players.find((p) => p.id === 'red')!.stockpile = { ...rich };
  return game;
}

describe('AI navy', () => {
  it('builds a port on the coast when nothing is left to take on foot', () => {
    const next = runAi(islands(), rules, 'red');
    const job = next.constructionQueue[0];
    expect(job?.buildingType).toBe('port');
    expect(job?.provinceId).toBe('r1'); // the only coastal province of the island
  });

  it('keeps the navy at home while there are still land targets', () => {
    const state = createGame({
      map: airMap,
      rules,
      players,
      owners: { r1: 'red', r2: 'red' },
      armies: [{ id: 'red-1', owner: 'red', location: 'r1', units: { infantry: 10 } }],
    });
    state.players.find((p) => p.id === 'red')!.stockpile = { ...rich };
    for (let i = 0; i < 5; i++) {
      const next = runAi(state, rules, 'red');
      expect(next.constructionQueue.every((j) => j.buildingType !== 'port')).toBe(true);
    }
  });

  it('crosses the sea, lands, and takes the other island', () => {
    const events: string[] = [];
    const end = runMatch(islands(), rules, {
      aiPlayers: ['red'],
      maxTicks: 250,
      onTick: (state) => state.events.forEach((e) => events.push(e.type)),
    });

    expect(events).toContain('army_landed');
    expect(end.provinces.find((p) => p.id === 'b1')?.owner).toBe('red');
    expect(end.outcome).toMatchObject({ winner: 'red' });
    // The sea stays nobody's.
    expect(end.provinces.filter(isSeaProvince).every((p) => p.owner === null)).toBe(true);
  });

  it('does not sail into an enemy force it cannot beat', () => {
    const end = runMatch(islands({ blueGuard: 400 }), rules, {
      aiPlayers: ['red'],
      maxTicks: 120,
    });
    expect(end.provinces.find((p) => p.id === 'b1')?.owner).toBe('blue');
  });

  it('plays the same way twice', () => {
    const run = () => runMatch(islands(), rules, { aiPlayers: ['red'], maxTicks: 60 });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
