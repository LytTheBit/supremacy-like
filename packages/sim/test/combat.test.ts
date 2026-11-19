import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  orderMove,
  previewBattle,
  tick,
  tinyMap,
  type GameState,
} from '../src';

const rules = baseRuleset;

describe('previewBattle', () => {
  it('lets the bigger army win', () => {
    const result = previewBattle(rules, { infantry: 15 }, { infantry: 10 });
    expect(result.winner).toBe('attacker');
    expect(result.attackerHpLeft).toBeGreaterThan(0);
    expect(result.defenderHpLeft).toBe(0);
  });

  it('is symmetric: equal armies annihilate each other', () => {
    const result = previewBattle(rules, { infantry: 10 }, { infantry: 10 });
    expect(result.winner).toBe('draw');
  });

  it('rewards concentration of force (square law)', () => {
    // Two armies of 10 attacking one after the other fare worse than one army of 20.
    const concentrated = previewBattle(rules, { infantry: 20 }, { infantry: 10 });
    const split = previewBattle(rules, { infantry: 10 }, { infantry: 10 });
    expect(concentrated.winner).toBe('attacker');
    expect(concentrated.attackerHpLeft).toBeGreaterThan(0.5);
    expect(split.winner).toBe('draw');
  });

  it('values artillery for its attack', () => {
    const result = previewBattle(rules, { artillery: 10 }, { infantry: 10 });
    expect(result.winner).toBe('attacker');
  });

  it('reports a stalemate when nobody can deal damage', () => {
    const passive = {
      ...rules,
      units: {
        dummy: { name: 'Dummy', attack: 0, defense: 1, hp: 1, speed: 1, cost: {}, trainingTicks: 1 },
      },
    };
    expect(previewBattle(passive, { dummy: 5 }, { dummy: 5 }).winner).toBe('stalemate');
  });
});

function skirmish(): GameState {
  const game = createGame({
    map: tinyMap,
    rules,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
    ],
    owners: { redhaven: 'red', westmark: 'red', eastmark: 'blue', bluehaven: 'blue' },
    armies: [
      { id: 'red-1', owner: 'red', location: 'westmark', units: { infantry: 15 } },
      { id: 'blue-1', owner: 'blue', location: 'eastmark', units: { infantry: 10 } },
    ],
  });
  const ordered = orderMove(game, 'red', 'red-1', 'eastmark');
  if (!ordered.ok) throw new Error('order failed');
  return ordered.state;
}

function playUntilQuiet(initial: GameState, maxTicks = 200): GameState {
  let state = initial;
  for (let i = 0; i < maxTicks; i++) {
    state = tick(state, rules);
    const owners = new Set(state.armies.map((a) => a.owner));
    if (owners.size < 2 && state.tick > 3) break;
  }
  return state;
}

describe('battles in the tick loop', () => {
  it('fights when armies meet and conquers the province for the winner', () => {
    const state = playUntilQuiet(skirmish());

    expect(state.armies.map((a) => a.id)).toEqual(['red-1']);
    expect(state.provinces.find((p) => p.id === 'eastmark')?.owner).toBe('red');
  });

  it('matches the preview outcome', () => {
    const preview = previewBattle(rules, { infantry: 15 }, { infantry: 10 });
    const state = playUntilQuiet(skirmish());
    const survivor = state.armies.find((a) => a.id === 'red-1');
    const survivorCount = Object.values(survivor?.units ?? {}).reduce((s, n) => s + n, 0);
    const previewCount = Object.values(preview.attackerLeft).reduce((s, n) => s + n, 0);

    expect(preview.winner).toBe('attacker');
    expect(survivorCount).toBeCloseTo(previewCount, 5);
  });

  it('emits battle, destruction and conquest events', () => {
    let state = skirmish();
    const types = new Set<string>();
    for (let i = 0; i < 100; i++) {
      state = tick(state, rules);
      state.events.forEach((e) => types.add(e.type));
    }
    expect(types).toContain('army_arrived');
    expect(types).toContain('battle');
    expect(types).toContain('army_destroyed');
    expect(types).toContain('province_conquered');
  });

  it('stops an army that runs into an enemy on its path', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players: [
        { id: 'red', name: 'Red' },
        { id: 'blue', name: 'Blue' },
      ],
      owners: {},
      armies: [
        { id: 'red-1', owner: 'red', location: 'redhaven', units: { infantry: 5 } },
        { id: 'blue-1', owner: 'blue', location: 'westmark', units: { infantry: 5 } },
      ],
    });
    const ordered = orderMove(game, 'red', 'red-1', 'bluehaven');
    if (!ordered.ok) throw new Error('order failed');

    let state = ordered.state;
    for (let i = 0; i < 2; i++) state = tick(state, rules);
    const red = state.armies.find((a) => a.id === 'red-1');
    // The red army reached westmark, met the enemy and dropped its order.
    expect(red?.location).toBe('westmark');
    expect(red?.order).toBeNull();
  });
});

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const run = () => {
      let state = skirmish();
      for (let i = 0; i < 40; i++) state = tick(state, rules);
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('never mutates the state passed to tick', () => {
    const state = skirmish();
    const snapshot = JSON.stringify(state);
    tick(state, rules);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
