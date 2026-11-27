import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  bombardPower,
  createGame,
  isEventVisible,
  orderHoldFire,
  shellingSurvival,
  tick,
  visibleProvinces,
  type GameState,
  type MapDef,
  type Units,
} from '../src';

//          coastA (blue)
//             |
//   far -- sea1 -- coastB (blue)
//             |
//          redport (red)
//
// coastA and coastB touch sea1. `far` is a blue province two steps from the sea.
const map: MapDef = {
  id: 'coast',
  provinces: [
    { id: 'redport', name: 'Redport', resource: 'iron', production: 1000 },
    { id: 'coastA', name: 'CoastA', resource: 'grain', production: 1000 },
    { id: 'coastB', name: 'CoastB', resource: 'wood', production: 1000 },
    { id: 'far', name: 'Far', resource: 'coal', production: 1000 },
    { id: 'sea1', name: 'Sea 1', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 'sea2', name: 'Sea 2', terrain: 'sea', resource: 'grain', production: 0 },
  ],
  edges: [
    { a: 'redport', b: 'sea1', distance: 1 },
    { a: 'sea1', b: 'coastA', distance: 1 },
    { a: 'sea1', b: 'coastB', distance: 1 },
    { a: 'coastA', b: 'far', distance: 1 },
    { a: 'sea1', b: 'sea2', distance: 1 },
  ],
};

const rules = { ...baseRuleset, victory: { provinceShare: 1 } };
const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];
const eve = [{ id: 'green', name: 'Green' }];
type Army = { id: string; owner: string; location: string; units: Units };

function game(armies: Army[], extraPlayers = false): GameState {
  return createGame({
    map,
    rules,
    players: extraPlayers ? [...players, ...eve] : players,
    owners: { redport: 'red', coastA: 'blue', coastB: 'blue', far: 'blue' },
    armies,
    buildings: [{ provinceId: 'redport', type: 'port' }],
  });
}

const army = (state: GameState, id: string) => state.armies.find((a) => a.id === id);
const infantry = (id: string, location: string, n: number): Army => ({ id, owner: 'blue', location, units: { infantry: n } });

function run(state: GameState, ticks: number): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, rules);
  return current;
}

describe('shelling formula', () => {
  it('only counts ships that can bombard', () => {
    expect(bombardPower(rules, { cruiser: 3 })).toBe(3 * (rules.units.cruiser?.bombard ?? 0));
    expect(bombardPower(rules, { battleship: 1, cruiser: 1 })).toBe(10 + 3);
    expect(bombardPower(rules, { transport: 4, infantry: 9 })).toBe(0);
  });

  it('leaves a force untouched without power and wipes out a tiny one', () => {
    expect(shellingSurvival(rules, 0, { infantry: 5 })).toBe(1);
    expect(shellingSurvival(rules, 5, {})).toBe(1);
    expect(shellingSurvival(rules, 500, { infantry: 5 })).toBe(0);
    const some = shellingSurvival(rules, 6, { infantry: 20 });
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(1);
  });

  it('hurts more with more power, and less against better defended troops', () => {
    expect(shellingSurvival(rules, 12, { infantry: 20 })).toBeLessThan(shellingSurvival(rules, 6, { infantry: 20 }));
    expect(shellingSurvival(rules, 6, { artillery: 20 })).not.toBe(shellingSurvival(rules, 6, { infantry: 20 }));
  });
});

describe('coastal bombardment in the simulation', () => {
  it('shells the enemy on an adjacent coast, with no return fire', () => {
    const state = run(
      game([
        { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 2 } },
        infantry('blue-1', 'coastA', 20),
      ]),
      3,
    );
    expect(army(state, 'blue-1')!.units.infantry!).toBeLessThan(20);
    expect(army(state, 'fleet')!.units.battleship).toBe(2); // untouched
    expect(army(state, 'fleet')!.location).toBe('sea1'); // did not move
  });

  it('records the shelling as an event', () => {
    let state = game([
      { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 1 } },
      infantry('blue-1', 'coastA', 20),
    ]);
    state = tick(state, rules);
    expect(state.events).toContainEqual({ tick: state.tick, type: 'coast_bombarded', armyId: 'fleet', provinceId: 'coastA' });
  });

  it('battleships hit harder than cruisers', () => {
    const left = (ship: string) =>
      army(
        run(game([{ id: 'fleet', owner: 'red', location: 'sea1', units: { [ship]: 2 } }, infantry('blue-1', 'coastA', 30)]), 2),
        'blue-1',
      )!.units.infantry!;
    expect(left('battleship')).toBeLessThan(left('cruiser'));
  });

  it('is an option of the ship: transports never shell', () => {
    const state = run(
      game([
        { id: 'fleet', owner: 'red', location: 'sea1', units: { transport: 3 } },
        infantry('blue-1', 'coastA', 20),
      ]),
      3,
    );
    expect(army(state, 'blue-1')!.units.infantry).toBe(20);
  });

  it('stops when the fleet is told to hold fire, and resumes when told to fire', () => {
    const start = game([
      { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 2 } },
      infantry('blue-1', 'coastA', 20),
    ]);
    const held = orderHoldFire(start, rules, 'red', 'fleet', true);
    if (!held.ok) throw new Error('hold fire failed');
    expect(army(run(held.state, 3), 'blue-1')!.units.infantry).toBe(20);

    const resumed = orderHoldFire(held.state, rules, 'red', 'fleet', false);
    if (!resumed.ok) throw new Error('fire failed');
    expect(army(resumed.state, 'fleet')?.holdFire).toBeUndefined();
    expect(army(run(resumed.state, 3), 'blue-1')!.units.infantry!).toBeLessThan(20);
  });

  it('shells only adjacent coasts, never inland or two seas away', () => {
    const state = run(
      game([
        { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 2 } },
        infantry('blue-far', 'far', 20), // not on the coast
        { id: 'sea2-fleet', owner: 'red', location: 'sea2', units: { battleship: 2 } }, // sea2 touches no land
      ]),
      3,
    );
    expect(army(state, 'blue-far')!.units.infantry).toBe(20);
  });

  it('picks the biggest enemy force among the adjacent coasts', () => {
    const state = run(
      game([
        { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 1 } },
        infantry('small', 'coastA', 5),
        infantry('big', 'coastB', 40),
      ]),
      1,
    );
    expect(army(state, 'big')!.units.infantry!).toBeLessThan(40);
    expect(army(state, 'small')!.units.infantry).toBe(5);
  });

  it('does not shell its own side or a player it is not at war with', () => {
    const base = game(
      [
        { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 2 } },
        { id: 'green-1', owner: 'green', location: 'coastB', units: { infantry: 10 } },
      ],
      true,
    );
    base.relations = [{ a: 'green', b: 'red', kind: 'alliance' }];
    expect(army(run(base, 3), 'green-1')!.units.infantry).toBe(10);
  });

  it('does not fire while the fleet is busy in a battle at sea', () => {
    const state = run(
      game([
        { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 1 } },
        { id: 'blue-fleet', owner: 'blue', location: 'sea1', units: { cruiser: 1 } },
        infantry('blue-1', 'coastA', 20),
      ]),
      1,
    );
    expect(army(state, 'blue-1')!.units.infantry).toBe(20);
  });

  it('does not fire from a port', () => {
    const state = game([
      { id: 'fleet', owner: 'red', location: 'redport', units: { battleship: 2 } },
      infantry('blue-1', 'redport', 0.001),
    ]);
    // Nothing is adjacent by sea from a land province: no event at all.
    expect(run(state, 2).events.some((e) => e.type === 'coast_bombarded')).toBe(false);
  });

  it('destroys a weak army completely and reports it', () => {
    let state = game([
      { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 6 } },
      infantry('blue-1', 'coastA', 2),
    ]);
    state = tick(state, rules);
    expect(army(state, 'blue-1')).toBeUndefined();
    expect(state.events.some((e) => e.type === 'army_destroyed' && e.armyId === 'blue-1')).toBe(true);
  });
});

describe('orderHoldFire', () => {
  const state = game([
    { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 1 } },
    { id: 'ferry', owner: 'red', location: 'sea1', units: { transport: 1 } },
  ]);

  it('only works for your own fleets with ships that can bombard', () => {
    expect(orderHoldFire(state, rules, 'blue', 'fleet', true)).toEqual({ ok: false, error: 'not_owner' });
    expect(orderHoldFire(state, rules, 'red', 'ferry', true)).toEqual({ ok: false, error: 'cannot_bombard' });
    expect(orderHoldFire(state, rules, 'red', 'nope', true)).toEqual({ ok: false, error: 'army_not_found' });
  });

  it('does not change the original state', () => {
    const result = orderHoldFire(state, rules, 'red', 'fleet', true);
    expect(result.ok).toBe(true);
    expect(army(state, 'fleet')?.holdFire).toBeUndefined();
  });
});

describe('visibility of shelling', () => {
  it('is reported to those who can see the shelled coast', () => {
    const state = game([
      { id: 'fleet', owner: 'red', location: 'sea1', units: { battleship: 1 } },
      infantry('blue-1', 'coastA', 20),
    ]);
    const event = { tick: 1, type: 'coast_bombarded' as const, armyId: 'fleet', provinceId: 'coastA' };
    expect(isEventVisible(event, visibleProvinces(state, rules, 'blue'), 'blue')).toBe(true);
    expect(isEventVisible(event, new Set(), 'red')).toBe(false);
  });
});

describe('createGame validation', () => {
  it('rejects bombard values on land units', () => {
    const bad = { ...rules, units: { ...rules.units, infantry: { ...rules.units.infantry!, bombard: 3 } } };
    expect(() => createGame({ map, rules: bad, players, owners: {}, armies: [] })).toThrow(/bombard/);
  });
});
