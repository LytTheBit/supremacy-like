import { describe, expect, it } from 'vitest';
import { baseRuleset, createGame, duelMap, runAi, runMatch, tick, type GameState, type Units } from '../src';

const rules = baseRuleset;

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
};

type ArmySetup = { id: string; owner: string; location: string; units: Units };

function duelGame(armies: ArmySetup[], buildings: { provinceId: string; type: string }[] = []): GameState {
  return createGame({ map: duelMap, rules, players, owners, armies, buildings });
}

function withStockpile(state: GameState, playerId: string, stock: Record<string, number>): GameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.id === playerId);
  if (!player) throw new Error('player not found');
  player.stockpile = { wood: 0, iron: 0, grain: 0, coal: 0, ...stock };
  return next;
}

// A baseline army for blue so it is never eliminated in these tests.
const blueGuard: ArmySetup = { id: 'b-guard', owner: 'blue', location: 'bcap', units: { infantry: 1 } };

describe('AI recruiting', () => {
  it('spends its resources on infantry in an owned province near the front', () => {
    const state = withStockpile(duelGame([blueGuard]), 'red', { grain: 40000, iron: 4000 });
    const next = runAi(state, rules, 'red');

    expect(next.recruitQueue).toHaveLength(1);
    const job = next.recruitQueue[0];
    expect(job).toMatchObject({ owner: 'red', unitType: 'infantry', count: 4 }); // limited by iron
    expect(next.provinces.find((p) => p.id === job?.provinceId)?.owner).toBe('red');

    const red = next.players.find((p) => p.id === 'red');
    expect(red?.stockpile).toMatchObject({ grain: 32000, iron: 0 });
  });

  it('caps batch sizes', () => {
    const state = withStockpile(duelGame([blueGuard]), 'red', { grain: 500000, iron: 500000, coal: 0 });
    const next = runAi(state, rules, 'red');
    expect(next.recruitQueue[0]?.count).toBe(10);
  });

  it('adds artillery when it can afford it', () => {
    // Artillery can only be trained where a factory stands.
    const state = withStockpile(duelGame([blueGuard], [{ provinceId: 'rcap', type: 'factory' }]), 'red', {
      grain: 40000,
      iron: 40000,
      coal: 40000,
    });
    const types = runAi(state, rules, 'red').recruitQueue.map((j) => j.unitType);
    expect(types).toEqual(['artillery', 'infantry']);
  });

  it('does nothing without resources', () => {
    const state = duelGame([blueGuard]);
    expect(runAi(state, rules, 'red').recruitQueue).toHaveLength(0);
  });
});

describe('AI movement', () => {
  const redArmy = (infantry: number): ArmySetup => ({
    id: 'r1',
    owner: 'red',
    location: 'rfront',
    units: { infantry },
  });

  it('sends a large army to the closest free province', () => {
    const next = runAi(duelGame([redArmy(10), blueGuard]), rules, 'red');
    const army = next.armies.find((a) => a.id === 'r1');
    // mnorth (distance 3) is the closest province red does not own.
    expect(army?.order?.path).toEqual(['mnorth']);
  });

  it('keeps small armies at home to grow', () => {
    const next = runAi(duelGame([redArmy(4), blueGuard]), rules, 'red');
    expect(next.armies.find((a) => a.id === 'r1')?.order).toBeNull();
  });

  it('does not attack through enemy forces it cannot beat', () => {
    const state = duelGame([
      redArmy(10),
      blueGuard,
      { id: 'b-north', owner: 'blue', location: 'mnorth', units: { infantry: 40 } },
      { id: 'b-south', owner: 'blue', location: 'msouth', units: { infantry: 40 } },
    ]);
    // Every route to a province red does not own crosses mnorth or msouth.
    // Without fog the AI sees the two big armies and stays home.
    const noFog = { ...rules, vision: { ...rules.vision, fog: false } };
    const next = runAi(state, noFog, 'red');
    expect(next.armies.find((a) => a.id === 'r1')?.order).toBeNull();
  });

  it('cannot see the big enemy armies through the fog, so it walks into them', () => {
    const state = duelGame([
      redArmy(10),
      blueGuard,
      { id: 'b-north', owner: 'blue', location: 'mnorth', units: { infantry: 40 } },
      { id: 'b-south', owner: 'blue', location: 'msouth', units: { infantry: 40 } },
    ]);
    const next = runAi(state, rules, 'red');
    expect(next.armies.find((a) => a.id === 'r1')?.order).not.toBeNull();
  });

  it('does not move armies that are fighting', () => {
    const state = duelGame([
      redArmy(10),
      blueGuard,
      { id: 'b-intruder', owner: 'blue', location: 'rfront', units: { infantry: 10 } },
    ]);
    const next = runAi(state, rules, 'red');
    expect(next.armies.find((a) => a.id === 'r1')?.order).toBeNull();
  });

  it('never changes the input state', () => {
    const state = withStockpile(duelGame([redArmy(10), blueGuard]), 'red', { grain: 40, iron: 10 });
    const snapshot = JSON.stringify(state);
    runAi(state, rules, 'red');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns the same state for eliminated players and finished games', () => {
    const state = duelGame([redArmy(10), blueGuard]);
    expect(runAi(state, rules, 'nobody')).toBe(state);

    const eliminated = { ...state, eliminated: ['red'] };
    expect(runAi(eliminated, rules, 'red')).toBe(eliminated);

    const over = { ...state, outcome: { winner: 'blue', winners: ['blue'], reason: 'last_standing' as const } };
    expect(runAi(over, rules, 'red')).toBe(over);
  });
});

describe('AI matches', () => {
  const start = (redUnits: number, blueUnits: number) =>
    duelGame([
      { id: 'red-1', owner: 'red', location: 'rfront', units: { infantry: redUnits } },
      { id: 'blue-1', owner: 'blue', location: 'bfront', units: { infantry: blueUnits } },
    ]);

  it('the stronger side wins a full AI vs AI match', () => {
    const final = runMatch(start(12, 6), rules, { aiPlayers: ['red', 'blue'], maxTicks: 200 });
    expect(final.outcome?.winner).toBe('red');
    expect(final.tick).toBeLessThan(200);
  });

  it('is deterministic', () => {
    const play = () => runMatch(start(12, 6), rules, { aiPlayers: ['red', 'blue'], maxTicks: 200 });
    expect(play()).toEqual(play());
  });

  it('stops at maxTicks when a symmetric match has no winner', () => {
    const final = runMatch(start(6, 6), rules, { aiPlayers: ['red', 'blue'], maxTicks: 50 });
    expect(final.outcome).toBeNull();
    expect(final.tick).toBe(50);
  });

  it('leaves non-AI players alone', () => {
    // Give blue resources: if the AI played for blue, it would recruit.
    const rich = withStockpile(start(12, 6), 'blue', { grain: 50000, iron: 50000, coal: 50000 });
    const owners = new Set<string>();
    runMatch(rich, rules, {
      aiPlayers: ['red'],
      maxTicks: 10,
      // Look at every tick: a batch can be finished by the last one.
      onTick: (state) => state.recruitQueue.forEach((job) => owners.add(job.owner)),
    });
    expect(owners.has('red')).toBe(true);
    expect(owners.has('blue')).toBe(false);
  });

  it('calls onTick once per tick', () => {
    const ticks: number[] = [];
    runMatch(start(12, 6), rules, {
      aiPlayers: ['red', 'blue'],
      maxTicks: 5,
      onTick: (s) => ticks.push(s.tick),
    });
    expect(ticks).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sanity', () => {
  it('a plain tick still works on the duel map', () => {
    const state = tick(duelGame([blueGuard]), rules);
    expect(state.tick).toBe(1);
  });
});
