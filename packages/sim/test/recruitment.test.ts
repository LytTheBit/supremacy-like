import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  orderMove,
  orderRecruit,
  tick,
  tinyMap,
  type GameState,
  type PlayerId,
  type ResourceId,
} from '../src';

const rules = baseRuleset;

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

/** Returns a copy of the state where a player has the given stockpile. */
function withStockpile(state: GameState, playerId: PlayerId, stock: Record<ResourceId, number>): GameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.id === playerId);
  if (!player) throw new Error('player not found');
  player.stockpile = { wood: 0, iron: 0, grain: 0, coal: 0, ...stock };
  return next;
}

function baseGame(): GameState {
  const game = createGame({
    map: tinyMap,
    rules,
    players,
    owners: { redhaven: 'red', bluehaven: 'blue' },
    armies: [],
    // Artillery needs a factory.
    buildings: [{ provinceId: 'redhaven', type: 'factory' }],
  });
  return withStockpile(game, 'red', { grain: 20000, iron: 10000, coal: 10000 });
}

function run(state: GameState, ticks: number): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, rules);
  return current;
}

function mustRecruit(
  state: GameState,
  playerId: PlayerId,
  provinceId: string,
  unitType: string,
  count: number,
): GameState {
  const result = orderRecruit(state, rules, playerId, provinceId, unitType, count);
  if (!result.ok) throw new Error(`recruit failed: ${result.error}`);
  return result.state;
}

describe('orderRecruit', () => {
  it('pays the full cost immediately and queues the batch', () => {
    const state = mustRecruit(baseGame(), 'red', 'redhaven', 'infantry', 4);
    const red = state.players.find((p) => p.id === 'red');

    // infantry costs 2000 grain + 1000 iron each.
    expect(red?.stockpile).toMatchObject({ grain: 12000, iron: 6000 });
    expect(state.recruitQueue).toHaveLength(1);
    expect(state.recruitQueue[0]).toMatchObject({
      owner: 'red',
      provinceId: 'redhaven',
      unitType: 'infantry',
      count: 4,
      ticksLeft: 2,
    });
  });

  it('rejects invalid orders with a reason', () => {
    const state = baseGame();
    const order = (...args: [PlayerId, string, string, number]) => orderRecruit(state, rules, ...args);

    expect(order('ghost', 'redhaven', 'infantry', 1)).toEqual({ ok: false, error: 'player_not_found' });
    expect(order('red', 'atlantis', 'infantry', 1)).toEqual({ ok: false, error: 'province_not_found' });
    expect(order('red', 'bluehaven', 'infantry', 1)).toEqual({ ok: false, error: 'not_owner' });
    expect(order('red', 'redhaven', 'dragon', 1)).toEqual({ ok: false, error: 'unknown_unit_type' });
    expect(order('red', 'redhaven', 'infantry', 0)).toEqual({ ok: false, error: 'invalid_count' });
    expect(order('red', 'redhaven', 'infantry', 1.5)).toEqual({ ok: false, error: 'invalid_count' });
    expect(order('red', 'redhaven', 'infantry', 11)).toEqual({ ok: false, error: 'insufficient_resources' });
  });

  it('refuses to recruit while an enemy army is in the province', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red' },
      armies: [{ id: 'blue-1', owner: 'blue', location: 'redhaven', units: { infantry: 1 } }],
    });
    const state = withStockpile(game, 'red', { grain: 20000, iron: 10000 });
    expect(orderRecruit(state, rules, 'red', 'redhaven', 'infantry', 1)).toEqual({
      ok: false,
      error: 'enemy_present',
    });
  });

  it('never mutates the input state', () => {
    const state = baseGame();
    const snapshot = JSON.stringify(state);
    orderRecruit(state, rules, 'red', 'redhaven', 'infantry', 2);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('training', () => {
  it('delivers a new army after the training time', () => {
    const ordered = mustRecruit(baseGame(), 'red', 'redhaven', 'infantry', 3);

    const afterOne = run(ordered, 1);
    expect(afterOne.armies).toHaveLength(0);
    expect(afterOne.recruitQueue).toHaveLength(1);

    const afterTwo = run(ordered, 2);
    expect(afterTwo.recruitQueue).toHaveLength(0);
    expect(afterTwo.armies).toHaveLength(1);
    expect(afterTwo.armies[0]).toMatchObject({
      owner: 'red',
      location: 'redhaven',
      units: { infantry: 3 },
      order: null,
    });
    expect(afterTwo.events.some((e) => e.type === 'recruit_completed')).toBe(true);
  });

  it('respects the training time of each unit type', () => {
    const ordered = mustRecruit(baseGame(), 'red', 'redhaven', 'artillery', 1);
    expect(run(ordered, 3).armies).toHaveLength(0);
    expect(run(ordered, 4).armies).toHaveLength(1);
  });

  it('merges new units into a stationary army of the same owner', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red', bluehaven: 'blue' },
      armies: [{ id: 'garrison', owner: 'red', location: 'redhaven', units: { infantry: 5 } }],
      buildings: [{ provinceId: 'redhaven', type: 'factory' }],
    });
    const ordered = mustRecruit(withStockpile(game, 'red', { grain: 20000, iron: 10000, coal: 10000 }), 'red', 'redhaven', 'artillery', 2);
    const state = run(ordered, 4);

    expect(state.armies).toHaveLength(1);
    expect(state.armies[0]).toMatchObject({ id: 'garrison', units: { infantry: 5, artillery: 2 } });
  });

  it('does not merge into an army that is moving out', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' },
      armies: [{ id: 'mover', owner: 'red', location: 'redhaven', units: { infantry: 5 } }],
    });
    let state = withStockpile(game, 'red', { grain: 20000, iron: 10000 });
    const move = orderMove(state, 'red', 'mover', 'westmark');
    if (!move.ok) throw new Error('move failed');
    state = mustRecruit(move.state, 'red', 'redhaven', 'infantry', 2);

    // After 1 tick the mover is still on its way (order set), the batch completes at tick 2.
    state = run(state, 2);
    const newcomers = state.armies.filter((a) => a.id !== 'mover');
    expect(state.armies.find((a) => a.id === 'mover')?.units).toEqual({ infantry: 5 });
    expect(newcomers).toHaveLength(1);
    expect(newcomers[0]?.units).toEqual({ infantry: 2 });
  });

  it('keeps batches independent and generates unique army ids', () => {
    let state = mustRecruit(baseGame(), 'red', 'redhaven', 'infantry', 1);
    state = run(state, 2);
    // The first batch is now a stationary army: the next one merges into it.
    state = mustRecruit(state, 'red', 'redhaven', 'infantry', 1);
    state = run(state, 2);
    expect(state.armies).toHaveLength(1);
    expect(state.armies[0]?.units).toEqual({ infantry: 2 });

    const ids = new Set(state.recruitQueue.map((j) => j.id));
    expect(ids.size).toBe(state.recruitQueue.length);
  });

  it('loses the batch if the province is conquered during training', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red' },
      armies: [],
    });
    let state = mustRecruit(withStockpile(game, 'red', { grain: 20000, iron: 10000 }), 'red', 'redhaven', 'infantry', 2);

    // Blue takes the province while the batch is still in training.
    const taken = structuredClone(state);
    const province = taken.provinces.find((p) => p.id === 'redhaven');
    if (!province) throw new Error('province not found');
    province.owner = 'blue';
    state = run(taken, 2);

    expect(state.armies).toHaveLength(0);
    expect(state.recruitQueue).toHaveLength(0);
    expect(state.events.some((e) => e.type === 'recruit_cancelled')).toBe(true);
  });
});

describe('economy to army loop', () => {
  it('turns produced resources into troops', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' },
      armies: [],
    });

    // redhaven makes 3000 grain/tick, westmark 2000 iron/tick: 2 ticks give 6000 grain + 4000 iron.
    let state = run(game, 2);
    state = mustRecruit(state, 'red', 'redhaven', 'infantry', 3);
    state = run(state, 2);

    expect(state.armies).toHaveLength(1);
    expect(state.armies[0]?.units).toEqual({ infantry: 3 });
  });

  it('is deterministic', () => {
    const play = () => run(mustRecruit(baseGame(), 'red', 'redhaven', 'infantry', 4), 5);
    expect(play()).toEqual(play());
  });
});
