import { describe, expect, it } from 'vitest';
import {
  airRange,
  attackAgainst,
  baseRuleset,
  createGame,
  findArmyPath,
  orderBuild,
  orderMove,
  orderRecruit,
  tick,
  type GameState,
  type MapDef,
  type Units,
} from '../src';

//   redbase -2- redland -3- bluefront -2- bluebase
//                  \                /
//                   2-- sea1 --2---
//
// Distances from redbase: redland 2, sea1 4, bluefront 5, bluebase 7.
const map: MapDef = {
  id: 'air',
  provinces: [
    { id: 'redbase', name: 'Redbase', resource: 'iron', production: 1000 },
    { id: 'redland', name: 'Redland', resource: 'grain', production: 1000 },
    { id: 'sea1', name: 'Sea 1', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 'bluefront', name: 'Bluefront', resource: 'wood', production: 1000 },
    { id: 'bluebase', name: 'Bluebase', resource: 'coal', production: 1000 },
  ],
  edges: [
    { a: 'redbase', b: 'redland', distance: 2 },
    { a: 'redland', b: 'bluefront', distance: 3 },
    { a: 'redland', b: 'sea1', distance: 2 },
    { a: 'sea1', b: 'bluefront', distance: 2 },
    { a: 'bluefront', b: 'bluebase', distance: 2 },
  ],
};

const rules = { ...baseRuleset, victory: { provinceShare: 1 } };
const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];
type Army = { id: string; owner: string; location: string; units: Units };

function game(armies: Army[], opts: { redAirfield?: boolean } = {}): GameState {
  return createGame({
    map,
    rules,
    players,
    owners: { redbase: 'red', redland: 'red', bluefront: 'blue', bluebase: 'blue' },
    armies,
    buildings: opts.redAirfield === false ? [] : [{ provinceId: 'redbase', type: 'airfield' }],
    stockpiles: { red: { wood: 50000, iron: 50000, grain: 50000, coal: 50000 } },
  });
}

function run(state: GameState, ticks: number): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, rules);
  return current;
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const army = (state: GameState, id: string) => state.armies.find((a) => a.id === id);
const blueInfantry: Army = { id: 'blue-inf', owner: 'blue', location: 'bluefront', units: { infantry: 6 } };

describe('flying within range of an airbase', () => {
  it('uses the shortest range among the aircraft', () => {
    expect(airRange(rules, { bomber: 2 })).toBe(8);
    expect(airRange(rules, { bomber: 2, fighter: 1 })).toBe(6);
    expect(airRange(rules, { infantry: 2 })).toBe(0);
  });

  it('flies over land and sea, as far as the range allows', () => {
    const state = game([{ id: 'air', owner: 'red', location: 'redbase', units: { fighter: 2 } }]);
    const fighter = army(state, 'air')!;
    expect(findArmyPath(state, rules, fighter, 'sea1')?.path).toEqual(['redland', 'sea1']);
    expect(findArmyPath(state, rules, fighter, 'bluefront')?.distance).toBe(5);
    // Bluebase is 7 away from the only base: out of reach for a fighter, within reach of a bomber.
    expect(orderMove(state, 'red', 'air', 'bluebase', rules)).toEqual({ ok: false, error: 'no_path' });
    const bombers = game([{ id: 'air', owner: 'red', location: 'redbase', units: { bomber: 2 } }]);
    expect(orderMove(bombers, 'red', 'air', 'bluebase', rules).ok).toBe(true);
  });

  it('cannot take off without an airbase', () => {
    const state = createGame({
      map,
      rules,
      players,
      owners: { redbase: 'red' },
      armies: [],
      buildings: [{ provinceId: 'redbase', type: 'airfield' }],
    });
    const grounded = structuredClone(state);
    grounded.provinces[0]!.buildings = [];
    grounded.armies.push({ id: 'air', owner: 'red', location: 'redbase', units: { bomber: 1 }, order: null });
    expect(orderMove(grounded, 'red', 'air', 'redland', rules)).toEqual({ ok: false, error: 'no_path' });
  });

  it('builds airfields anywhere on land and trains aircraft as their own army', () => {
    let state = game([{ id: 'troops', owner: 'red', location: 'redbase', units: { infantry: 4 } }]);
    expect(orderBuild(state, rules, 'red', 'redland', 'airfield').ok).toBe(true);
    state = ok(orderRecruit(state, rules, 'red', 'redbase', 'fighter', 2)).state;
    state = run(state, 5);
    expect(state.armies.find((a) => a.units.fighter !== undefined)?.units).toEqual({ fighter: 2 });
    expect(army(state, 'troops')?.units).toEqual({ infantry: 4 });
  });
});

describe('raids', () => {
  const raid = (units: Units) =>
    ok(
      orderMove(
        game([{ id: 'air', owner: 'red', location: 'redbase', units }, blueInfantry]),
        'red',
        'air',
        'bluefront',
        rules,
      ),
    ).state;

  it('uses the multipliers: bombers hurt ground troops more, and rifles hurt bombers less', () => {
    const withVs = run(raid({ bomber: 1 }), 4);
    const plainRules = {
      ...rules,
      units: Object.fromEntries(Object.entries(rules.units).map(([id, def]) => [id, { ...def, vs: undefined }])),
    };
    let withoutVs = raid({ bomber: 1 });
    for (let i = 0; i < 4; i++) withoutVs = tick(withoutVs, plainRules);

    expect(army(withVs, 'air')?.location).toBe('bluefront');
    expect(army(withVs, 'blue-inf')!.units.infantry!).toBeLessThan(army(withoutVs, 'blue-inf')!.units.infantry!);
    // Without the multipliers the rifles wipe the lone bomber out completely.
    expect(army(withVs, 'air')!.units.bomber!).toBeGreaterThan(army(withoutVs, 'air')?.units.bomber ?? 0);
  });

  it('flies back to the base by itself when nobody is left to fight', () => {
    let state = raid({ bomber: 9 });
    state = run(state, 40);
    expect(army(state, 'blue-inf')).toBeUndefined();
    const bombers = army(state, 'air')!;
    expect(bombers.location).toBe('redbase');
    expect(bombers.order).toBeNull();
  });

  it('can leave a fight whenever it wants, unlike ground troops', () => {
    let state = raid({ bomber: 1 });
    state = run(state, 4);
    expect(army(state, 'air')?.location).toBe('bluefront');
    state = ok(orderMove(state, 'red', 'air', 'redbase', rules)).state;
    state = run(state, 4);
    expect(army(state, 'air')?.location).not.toBe('bluefront');
  });

  it('never conquers a province', () => {
    const state = run(
      ok(
        orderMove(
          game([{ id: 'air', owner: 'red', location: 'redbase', units: { bomber: 3 } }]),
          'red',
          'air',
          'bluefront',
          rules,
        ),
      ).state,
      3,
    );
    expect(state.provinces.find((p) => p.id === 'bluefront')?.owner).toBe('blue');
  });

  it('is lost when the last airbase in reach disappears', () => {
    let state = ok(
      orderMove(
        game([{ id: 'air', owner: 'red', location: 'redbase', units: { fighter: 2 } }]),
        'red',
        'air',
        'sea1',
        rules,
      ),
    ).state;
    state = run(state, 3); // over the sea, flying around
    expect(army(state, 'air')).toBeDefined();
    state.provinces.find((p) => p.id === 'redbase')!.buildings = []; // the airfield is destroyed
    let destroyed = false;
    for (let i = 0; i < 6; i++) {
      state = tick(state, rules);
      destroyed ||= state.events.some((e) => e.type === 'army_destroyed');
    }
    expect(army(state, 'air')).toBeUndefined();
    expect(destroyed).toBe(true);
  });
});

describe('combat against aircraft', () => {
  it('weights attack by what the enemy has in each domain', () => {
    // Fighters are weak against ground troops, strong against aircraft.
    const vsLand = attackAgainst(rules, { fighter: 2 }, { infantry: 5 });
    const vsAir = attackAgainst(rules, { fighter: 2 }, { fighter: 5 });
    expect(vsLand).toBeCloseTo(4 * 2 * 0.5);
    expect(vsAir).toBeCloseTo(4 * 2 * 1.5);
    // A mixed target uses the mix.
    expect(attackAgainst(rules, { fighter: 2 }, { infantry: 5, fighter: 5 })).toBeCloseTo(8 * 1);
  });

  it('is the plain attack when no unit has multipliers', () => {
    const plain = {
      ...rules,
      units: Object.fromEntries(Object.entries(rules.units).map(([id, def]) => [id, { ...def, vs: undefined }])),
    };
    expect(attackAgainst(plain, { bomber: 3 }, { infantry: 5, fighter: 2 })).toBeCloseTo(3 * 9);
  });

  it('leaves artillery helpless against an air raid', () => {
    const state = run(
      ok(
        orderMove(
          game([
            { id: 'air', owner: 'red', location: 'redbase', units: { fighter: 2 } },
            { id: 'guns', owner: 'blue', location: 'bluefront', units: { artillery: 8 } },
          ]),
          'red',
          'air',
          'bluefront',
          rules,
        ),
      ).state,
      5,
    );
    expect(army(state, 'air')?.units.fighter).toBeCloseTo(2, 5);
    expect(army(state, 'guns')!.units.artillery!).toBeLessThan(8);
  });

  it('keeps aircraft fighting over the sea while land cargo does not', () => {
    // Aircraft can only start at a base, so put them over the sea by hand.
    const start = game([{ id: 'fleet', owner: 'blue', location: 'sea1', units: { transport: 6 } }]);
    start.armies.push({ id: 'air', owner: 'red', location: 'sea1', units: { bomber: 2 }, order: null });
    const state = tick(start, rules);
    expect(army(state, 'fleet')!.units.transport!).toBeLessThan(6);
  });
});

describe('createGame validation for aircraft', () => {
  const base = { map, rules, players, owners: { redbase: 'red' } };
  const airfield = [{ provinceId: 'redbase', type: 'airfield' }];

  it('needs an airbase and no other kind of unit in the same army', () => {
    const at = (units: Units) => [{ id: 'a', owner: 'red', location: 'redbase', units }];
    expect(() => createGame({ ...base, armies: at({ bomber: 1 }) })).toThrow(/outside an airbase/);
    expect(() => createGame({ ...base, armies: at({ bomber: 1, infantry: 1 }), buildings: airfield })).toThrow(/mixes/);
    expect(() => createGame({ ...base, armies: at({ bomber: 1 }), buildings: airfield })).not.toThrow();
  });

  it('rejects air units without a range and ranges on other units', () => {
    const noRange = { ...rules, units: { ...rules.units, ufo: { ...rules.units.fighter!, range: undefined } } };
    expect(() => createGame({ ...base, rules: noRange, armies: [] })).toThrow(/range/);
    const landRange = { ...rules, units: { ...rules.units, infantry: { ...rules.units.infantry!, range: 3 } } };
    expect(() => createGame({ ...base, rules: landRange, armies: [] })).toThrow(/range/);
  });
});
