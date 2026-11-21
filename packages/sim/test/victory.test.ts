import { describe, expect, it } from 'vitest';
import { baseRuleset, createGame, orderMove, orderRecruit, tick, tinyMap, type GameState } from '../src';

const rules = baseRuleset;

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

function game(owners: Record<string, string>, armies: Parameters<typeof createGame>[0]['armies'] = []): GameState {
  return createGame({ map: tinyMap, rules, players, owners, armies });
}

describe('victory by domination', () => {
  it('ends the game when a player owns 60% of all provinces', () => {
    // 3 of 5 provinces.
    let state = game(
      { redhaven: 'red', westmark: 'red', midfield: 'red', bluehaven: 'blue' },
      [{ id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: 1 } }],
    );
    state = tick(state, rules);

    expect(state.outcome).toEqual({ winner: 'red', winners: ['red'], reason: 'domination' });
    expect(state.events.some((e) => e.type === 'game_over')).toBe(true);
  });

  it('does not end the game below the threshold', () => {
    const state = tick(game({ redhaven: 'red', westmark: 'red', bluehaven: 'blue' }), rules);
    expect(state.outcome).toBeNull();
  });

  it('is reached by conquering provinces with armies', () => {
    let state = game(
      { redhaven: 'red', westmark: 'red', eastmark: 'blue', bluehaven: 'blue' },
      [
        { id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 15 } },
        { id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: 1 } },
      ],
    );
    const ordered = orderMove(state, 'red', 'r1', 'midfield');
    if (!ordered.ok) throw new Error('order failed');
    state = ordered.state;

    // Midfield is neutral: conquering it gives red 3 of 5 provinces.
    for (let i = 0; i < 4 && !state.outcome; i++) state = tick(state, rules);
    expect(state.outcome).toEqual({ winner: 'red', winners: ['red'], reason: 'domination' });
  });
});

describe('elimination and last standing', () => {
  it('eliminates a player with no provinces, armies or recruit batches', () => {
    // Red holds 2 of 5 provinces; blue has nothing, so only blue is eliminated.
    const state = tick(game({ redhaven: 'red', westmark: 'red' }, [
      { id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: 1 } },
    ]), rules);

    expect(state.eliminated).toEqual(['blue']);
    expect(state.events.some((e) => e.type === 'player_eliminated' && e.playerId === 'blue')).toBe(true);
    expect(state.outcome).toEqual({ winner: 'red', winners: ['red'], reason: 'last_standing' });
  });

  it('keeps a player alive while they still have an army or a batch in training', () => {
    // Blue has no provinces but still has an army.
    let state = game({ redhaven: 'red' }, [
      { id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: 1 } },
    ]);
    state = tick(state, rules);
    expect(state.eliminated).toEqual([]);

    // Red has a province and a recruit batch in training: still in the game.
    let withBatch = game({ redhaven: 'red', bluehaven: 'blue' });
    const player = withBatch.players.find((p) => p.id === 'red');
    if (!player) throw new Error('player not found');
    player.stockpile = { wood: 0, iron: 5000, grain: 5000, coal: 0 };
    const recruit = orderRecruit(withBatch, rules, 'red', 'redhaven', 'infantry', 2);
    if (!recruit.ok) throw new Error('recruit failed');
    withBatch = recruit.state;
    expect(tick(withBatch, rules).eliminated).toEqual([]);
  });

  it('declares extinction when nobody is left', () => {
    const state = tick(game({}), rules);
    expect(state.outcome).toEqual({ winner: null, winners: [], reason: 'extinction' });
  });

  it('does not declare a last-standing winner in a one-player game', () => {
    const solo = createGame({
      map: tinyMap,
      rules,
      players: [{ id: 'red', name: 'Red' }],
      owners: { redhaven: 'red' },
      armies: [],
    });
    expect(tick(solo, rules).outcome).toBeNull();
  });
});

describe('after the game is over', () => {
  function finished(): GameState {
    return tick(
      game({ redhaven: 'red', westmark: 'red', midfield: 'red', bluehaven: 'blue' }, [
        { id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: 1 } },
        { id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: 1 } },
      ]),
      rules,
    );
  }

  it('freezes the game: tick changes nothing and emits no events', () => {
    const over = finished();
    const after = tick(over, rules);
    expect(after.tick).toBe(over.tick);
    expect(after.events).toEqual([]);
    expect({ ...after, events: [] }).toEqual({ ...over, events: [] });
  });

  it('rejects orders with game_over', () => {
    const over = finished();
    expect(orderMove(over, 'red', 'r1', 'westmark')).toEqual({ ok: false, error: 'game_over' });
    expect(orderRecruit(over, rules, 'red', 'redhaven', 'infantry', 1)).toEqual({
      ok: false,
      error: 'game_over',
    });
  });
});

describe('createGame victory validation', () => {
  it('requires provinceShare in (0.5, 1]', () => {
    for (const provinceShare of [0.5, 0.2, 1.2]) {
      expect(() =>
        createGame({
          map: tinyMap,
          rules: { ...rules, victory: { provinceShare } },
          players,
          owners: {},
          armies: [],
        }),
      ).toThrow(/provinceShare/);
    }
  });
});

describe('idle army merging', () => {
  it('merges idle armies of the same owner standing in the same province', () => {
    // Blue holds a province so the game stays alive.
    let state = game({ redhaven: 'red', bluehaven: 'blue' }, [
      { id: 'r-b', owner: 'red', location: 'redhaven', units: { infantry: 3 } },
      { id: 'r-a', owner: 'red', location: 'redhaven', units: { infantry: 2, artillery: 1 } },
    ]);
    state = tick(state, rules);

    expect(state.armies).toHaveLength(1);
    // The lowest id survives.
    expect(state.armies[0]).toMatchObject({ id: 'r-a', units: { infantry: 5, artillery: 1 } });
  });

  it('does not merge armies that have a movement order', () => {
    let state = game({ redhaven: 'red', bluehaven: 'blue' }, [
      { id: 'r-a', owner: 'red', location: 'redhaven', units: { infantry: 3 } },
      { id: 'r-b', owner: 'red', location: 'redhaven', units: { infantry: 2 } },
    ]);
    const ordered = orderMove(state, 'red', 'r-b', 'westmark');
    if (!ordered.ok) throw new Error('order failed');
    state = tick(ordered.state, rules);

    expect(state.armies.map((a) => a.id)).toEqual(['r-a', 'r-b']);
  });

  it('never merges armies of different owners', () => {
    const state = tick(
      game({ redhaven: 'red', bluehaven: 'blue' }, [
        { id: 'r1', owner: 'red', location: 'midfield', units: { infantry: 1 } },
        { id: 'b1', owner: 'blue', location: 'midfield', units: { infantry: 1 } },
      ]),
      rules,
    );
    expect(state.armies.map((a) => a.owner).sort()).toEqual(['blue', 'red']);
  });
});
