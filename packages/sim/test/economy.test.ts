import { describe, expect, it } from 'vitest';
import { baseRuleset, createGame, tick, tinyMap } from '../src';

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

describe('economy', () => {
  it('produces resources every tick for owned provinces only', () => {
    let state = createGame({
      map: tinyMap,
      rules: baseRuleset,
      players,
      owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' },
      armies: [],
    });

    for (let i = 0; i < 3; i++) state = tick(state, baseRuleset);

    const red = state.players.find((p) => p.id === 'red');
    const blue = state.players.find((p) => p.id === 'blue');
    // redhaven: 3 grain/tick, westmark: 2 iron/tick, bluehaven: 3 grain/tick
    expect(red?.stockpile).toEqual({ wood: 0, iron: 6, grain: 9, coal: 0 });
    expect(blue?.stockpile).toEqual({ wood: 0, iron: 0, grain: 9, coal: 0 });
  });

  it('neutral provinces produce nothing', () => {
    let state = createGame({
      map: tinyMap,
      rules: baseRuleset,
      players,
      owners: {},
      armies: [],
    });
    state = tick(state, baseRuleset);
    for (const player of state.players) {
      expect(Object.values(player.stockpile).every((v) => v === 0)).toBe(true);
    }
  });

  it('rejects setups that reference unknown data', () => {
    expect(() =>
      createGame({
        map: tinyMap,
        rules: baseRuleset,
        players,
        owners: { nowhere: 'red' },
        armies: [],
      }),
    ).toThrow(/Unknown province/);

    expect(() =>
      createGame({
        map: tinyMap,
        rules: baseRuleset,
        players,
        owners: {},
        armies: [{ id: 'a', owner: 'red', location: 'redhaven', units: { dragon: 1 } }],
      }),
    ).toThrow(/unknown unit type/);
  });
});
