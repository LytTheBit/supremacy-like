import { describe, expect, it } from 'vitest';
import { armySpeed, baseRuleset, createGame, orderMove, tick, tinyMap, type GameState, type Units } from '../src';

// Victory needs ALL provinces here, so conquests along the way never end the game
// and these tests only measure movement.
const rules = { ...baseRuleset, victory: { provinceShare: 1 } };

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

function gameWithArmy(units: Units): GameState {
  return createGame({
    map: tinyMap,
    rules: rules,
    players,
    // Blue owns a province so it is not eliminated on the first tick.
    owners: { redhaven: 'red', bluehaven: 'blue' },
    armies: [{ id: 'a1', owner: 'red', location: 'redhaven', units }],
  });
}

function locationOf(state: GameState): string | undefined {
  return state.armies.find((a) => a.id === 'a1')?.location;
}

function run(state: GameState, ticks: number): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, rules);
  return current;
}

describe('movement', () => {
  it('moves infantry along an edge in distance / speed ticks', () => {
    const ordered = orderMove(gameWithArmy({ infantry: 5 }), 'red', 'a1', 'westmark');
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;

    // redhaven -> westmark has distance 2, infantry speed is 1.
    const afterOne = run(ordered.state, 1);
    expect(locationOf(afterOne)).toBe('redhaven');
    const afterTwo = run(ordered.state, 2);
    expect(locationOf(afterTwo)).toBe('westmark');
    expect(afterTwo.armies[0]?.order).toBeNull();
    expect(afterTwo.events.some((e) => e.type === 'army_arrived')).toBe(true);
  });

  it('moves at the speed of the slowest unit in the army', () => {
    expect(armySpeed(rules, { infantry: 5 })).toBe(1);
    expect(armySpeed(rules, { infantry: 5, artillery: 1 })).toBe(0.5);

    const ordered = orderMove(gameWithArmy({ infantry: 5, artillery: 1 }), 'red', 'a1', 'westmark');
    if (!ordered.ok) throw new Error('order failed');
    expect(locationOf(run(ordered.state, 3))).toBe('redhaven');
    expect(locationOf(run(ordered.state, 4))).toBe('westmark');
  });

  it('follows multi-hop paths', () => {
    const ordered = orderMove(gameWithArmy({ infantry: 5 }), 'red', 'a1', 'bluehaven');
    if (!ordered.ok) throw new Error('order failed');
    // redhaven -> westmark (2) -> eastmark (3) -> bluehaven (2) = 7 ticks.
    expect(locationOf(run(ordered.state, 6))).not.toBe('bluehaven');
    expect(locationOf(run(ordered.state, 7))).toBe('bluehaven');
  });
});

describe('orders', () => {
  it('validates the order and never mutates the input state', () => {
    const state = gameWithArmy({ infantry: 5 });
    const snapshot = JSON.stringify(state);

    expect(orderMove(state, 'blue', 'a1', 'westmark')).toEqual({ ok: false, error: 'not_owner' });
    expect(orderMove(state, 'red', 'nope', 'westmark')).toEqual({ ok: false, error: 'army_not_found' });
    expect(orderMove(state, 'red', 'a1', 'atlantis')).toEqual({ ok: false, error: 'province_not_found' });
    expect(orderMove(state, 'red', 'a1', 'redhaven')).toEqual({ ok: false, error: 'already_there' });

    const ok = orderMove(state, 'red', 'a1', 'westmark');
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('reports unreachable targets', () => {
    const isolated = createGame({
      map: {
        id: 'split',
        provinces: [
          { id: 'a', name: 'A', resource: 'wood', production: 1 },
          { id: 'b', name: 'B', resource: 'wood', production: 1 },
        ],
        edges: [],
      },
      rules: rules,
      players,
      owners: {},
      armies: [{ id: 'a1', owner: 'red', location: 'a', units: { infantry: 1 } }],
    });
    expect(orderMove(isolated, 'red', 'a1', 'b')).toEqual({ ok: false, error: 'no_path' });
  });
});
