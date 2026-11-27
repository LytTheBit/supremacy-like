import { describe, expect, it } from 'vitest';
import {
  armySpeed,
  baseRuleset,
  cargoCapacity,
  createGame,
  createSkirmish,
  findArmyPath,
  generateHexMap,
  isCoastal,
  orderBuild,
  orderDisembark,
  orderEmbark,
  orderMove,
  orderRecruit,
  runMatch,
  tick,
  toMapDef,
  validateHexMap,
  type GameState,
  type MapDef,
  type Units,
} from '../src';

// A coast to coast crossing:
//
//   redland -1- redport -1- sea1 -2- sea2 -1- bluecoast -1- blueland
//
// Land provinces are owned by red (west) and blue (east); the sea provinces belong to nobody.
const seaMap: MapDef = {
  id: 'crossing',
  provinces: [
    { id: 'redland', name: 'Redland', resource: 'grain', production: 2000 },
    { id: 'redport', name: 'Redport', resource: 'iron', production: 2000 },
    { id: 'sea1', name: 'Sea 1', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 'sea2', name: 'Sea 2', terrain: 'sea', resource: 'grain', production: 0 },
    { id: 'bluecoast', name: 'Bluecoast', resource: 'wood', production: 2000 },
    { id: 'blueland', name: 'Blueland', resource: 'coal', production: 2000 },
  ],
  edges: [
    { a: 'redland', b: 'redport', distance: 1 },
    { a: 'redport', b: 'sea1', distance: 1 },
    { a: 'sea1', b: 'sea2', distance: 2 },
    { a: 'sea2', b: 'bluecoast', distance: 1 },
    { a: 'bluecoast', b: 'blueland', distance: 1 },
  ],
};

// Nobody wins by domination in these tests, so they only measure the naval rules.
const rules = { ...baseRuleset, victory: { provinceShare: 1 } };

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

type Army = { id: string; owner: string; location: string; units: Units };

function game(armies: Army[], extra: { blueHarbor?: boolean } = {}): GameState {
  return createGame({
    map: seaMap,
    rules,
    players,
    owners: { redland: 'red', redport: 'red', bluecoast: 'blue', blueland: 'blue' },
    armies,
    buildings: [
      { provinceId: 'redport', type: 'port' },
      ...(extra.blueHarbor ? [{ provinceId: 'bluecoast', type: 'port' }] : []),
    ],
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

describe('sea provinces and movement rules', () => {
  it('lets land troops walk on land only', () => {
    const state = game([
      { id: 'land', owner: 'red', location: 'redland', units: { infantry: 5 } },
      { id: 'blue-1', owner: 'blue', location: 'blueland', units: { infantry: 5 } },
    ]);
    expect(orderMove(state, 'red', 'land', 'sea1')).toEqual({ ok: false, error: 'no_path' });
    // The enemy coast is only reachable by crossing the sea.
    expect(orderMove(state, 'red', 'land', 'bluecoast', rules)).toEqual({ ok: false, error: 'no_path' });
    expect(ok(orderMove(state, 'red', 'land', 'redport', rules)).state.armies[0]?.order?.path).toEqual(['redport']);
  });

  it('lets a fleet sail and dock in its own port, but not enter enemy land', () => {
    const state = game([{ id: 'fleet', owner: 'red', location: 'redport', units: { cruiser: 2 } }]);
    expect(findArmyPath(state, rules, army(state, 'fleet')!, 'sea2')?.path).toEqual(['sea1', 'sea2']);
    expect(orderMove(state, 'red', 'fleet', 'bluecoast', rules)).toEqual({ ok: false, error: 'no_path' });
    // Ships never cross land: the inland province is out of reach.
    expect(orderMove(state, 'red', 'fleet', 'redland', rules)).toEqual({ ok: false, error: 'no_path' });
  });

  it('lets a fleet dock in the port of an ally', () => {
    const state = game([{ id: 'fleet', owner: 'red', location: 'redport', units: { cruiser: 2 } }], {
      blueHarbor: true,
    });
    expect(orderMove(state, 'red', 'fleet', 'bluecoast', rules)).toEqual({ ok: false, error: 'no_path' });
    const allied = { ...state, relations: [{ a: 'blue', b: 'red', kind: 'alliance' as const }] };
    expect(ok(orderMove(allied, 'red', 'fleet', 'bluecoast', rules)).state.armies[0]?.order?.path).toEqual([
      'sea1',
      'sea2',
      'bluecoast',
    ]);
  });

  it('moves cargo at the speed of the ships', () => {
    expect(armySpeed(rules, { transport: 1, infantry: 5, artillery: 1 })).toBe(rules.units.transport?.speed);
    expect(armySpeed(rules, { infantry: 5, artillery: 1 })).toBe(rules.units.artillery?.speed);
  });

  it('refuses to sail with more cargo than the ships can carry', () => {
    const state = game([
      { id: 'fleet', owner: 'red', location: 'redport', units: { transport: 1, infantry: 10 } },
    ]);
    expect(cargoCapacity(rules, { transport: 1 })).toBe(10);
    expect(orderMove(state, 'red', 'fleet', 'sea1', rules).ok).toBe(true);
    const overloaded = structuredClone(state);
    overloaded.armies[0]!.units = { transport: 1, infantry: 11 };
    expect(orderMove(overloaded, 'red', 'fleet', 'sea1', rules)).toEqual({ ok: false, error: 'no_path' });
  });

  it('never gives a sea province an owner', () => {
    const state = run(
      game([{ id: 'fleet', owner: 'red', location: 'redport', units: { transport: 1, infantry: 5 } }]),
      1,
    );
    const sailing = ok(orderMove(state, 'red', 'fleet', 'sea2', rules)).state;
    const later = run(sailing, 8);
    expect(army(later, 'fleet')?.location).toBe('sea2');
    expect(later.provinces.find((p) => p.id === 'sea2')?.owner).toBeNull();
    expect(later.provinces.find((p) => p.id === 'sea1')?.owner).toBeNull();
  });
});

describe('embarking, landing and disembarking', () => {
  const docked = () =>
    game([
      { id: 'fleet', owner: 'red', location: 'redport', units: { transport: 2 } },
      { id: 'troops', owner: 'red', location: 'redport', units: { infantry: 15 } },
      { id: 'blue-1', owner: 'blue', location: 'blueland', units: { infantry: 3 } },
    ]);

  it('keeps fleets and land armies apart in the same port', () => {
    const state = run(docked(), 3);
    expect(state.armies.filter((a) => a.owner === 'red')).toHaveLength(2);
  });

  it('loads land troops onto a docked fleet', () => {
    const state = ok(orderEmbark(docked(), rules, 'red', 'troops', 'fleet')).state;
    expect(state.armies.map((a) => a.id).sort()).toEqual(['blue-1', 'fleet']);
    expect(army(state, 'fleet')?.units).toEqual({ transport: 2, infantry: 15 });
  });

  it('refuses to embark beyond the capacity, away from the fleet or from a moving fleet', () => {
    const tooMany = docked();
    tooMany.armies.find((a) => a.id === 'troops')!.units = { infantry: 21 };
    expect(orderEmbark(tooMany, rules, 'red', 'troops', 'fleet')).toEqual({ ok: false, error: 'over_capacity' });

    const apart = docked();
    apart.armies.find((a) => a.id === 'troops')!.location = 'redland';
    expect(orderEmbark(apart, rules, 'red', 'troops', 'fleet')).toEqual({ ok: false, error: 'not_same_province' });

    expect(orderEmbark(docked(), rules, 'blue', 'troops', 'fleet')).toEqual({ ok: false, error: 'not_owner' });
    expect(orderEmbark(docked(), rules, 'red', 'fleet', 'troops')).toEqual({ ok: false, error: 'not_land_army' });
  });

  it('unloads a docked fleet with orderDisembark', () => {
    const loaded = ok(orderEmbark(docked(), rules, 'red', 'troops', 'fleet')).state;
    const state = ok(orderDisembark(loaded, rules, 'red', 'fleet')).state;
    const fleet = army(state, 'fleet');
    expect(fleet?.units).toEqual({ transport: 2 });
    const landed = state.armies.find((a) => a.owner === 'red' && a.id !== 'fleet');
    expect(landed?.units).toEqual({ infantry: 15 });
    expect(landed?.location).toBe('redport');
    expect(orderDisembark(state, rules, 'red', 'fleet')).toEqual({ ok: false, error: 'nothing_to_unload' });
  });

  it('lands troops on an enemy coast: the troops stay, the ships remain at sea', () => {
    let state = ok(orderEmbark(docked(), rules, 'red', 'troops', 'fleet')).state;
    state = ok(orderMove(state, 'red', 'fleet', 'bluecoast', rules)).state;

    const events: string[] = [];
    for (let i = 0; i < 20; i++) {
      state = tick(state, rules);
      for (const e of state.events) events.push(e.type);
      if (events.includes('army_landed')) break;
    }
    expect(events).toContain('army_landed');

    const landed = army(state, 'fleet');
    expect(landed?.location).toBe('bluecoast');
    expect(landed?.units).toEqual({ infantry: 15 });
    expect(landed?.order).toBeNull();

    const ships = state.armies.find((a) => a.owner === 'red' && a.id !== 'fleet');
    expect(ships?.units).toEqual({ transport: 2 });
    expect(ships?.location).toBe('sea2');
    expect(ships?.order).toBeNull();
  });

  it('takes the coast after landing when nobody defends it', () => {
    let state = ok(orderEmbark(docked(), rules, 'red', 'troops', 'fleet')).state;
    state = ok(orderMove(state, 'red', 'fleet', 'bluecoast', rules)).state;
    state = run(state, 12);
    expect(state.provinces.find((p) => p.id === 'bluecoast')?.owner).toBe('red');
  });

  it('does not let a fleet conquer the province of a former ally', () => {
    const state = game(
      [{ id: 'fleet', owner: 'red', location: 'bluecoast', units: { cruiser: 2 } }],
      { blueHarbor: true },
    );
    const later = run(state, 3);
    expect(later.provinces.find((p) => p.id === 'bluecoast')?.owner).toBe('blue');
  });
});

describe('combat at sea', () => {
  const fleetBattle = (cargo: number): GameState => {
    const state = game([
      { id: 'red-fleet', owner: 'red', location: 'sea1', units: cargo > 0 ? { transport: 3, infantry: cargo } : { transport: 3 } },
      { id: 'blue-fleet', owner: 'blue', location: 'sea1', units: { cruiser: 3 } },
    ]);
    return tick(state, rules);
  };

  it('ignores the cargo when damage is dealt and taken', () => {
    const empty = fleetBattle(0);
    const loaded = fleetBattle(20);
    // The enemy's losses and the ships' losses do not depend on the cargo.
    expect(army(loaded, 'blue-fleet')?.units.cruiser).toBeCloseTo(army(empty, 'blue-fleet')?.units.cruiser ?? -1);
    expect(army(loaded, 'red-fleet')?.units.transport).toBeCloseTo(army(empty, 'red-fleet')?.units.transport ?? -1);
  });

  it('loses the cargo together with the ships', () => {
    const loaded = fleetBattle(20);
    const units = army(loaded, 'red-fleet')!.units;
    const shipShare = (units.transport ?? 0) / 3;
    const cargoShare = (units.infantry ?? 0) / 20;
    expect(shipShare).toBeLessThan(1);
    expect(cargoShare).toBeCloseTo(shipShare);
  });

  it('makes the cargo vulnerable: a lost fleet takes everybody down', () => {
    let state = game([
      { id: 'red-fleet', owner: 'red', location: 'sea1', units: { transport: 1, infantry: 10 } },
      { id: 'blue-fleet', owner: 'blue', location: 'sea1', units: { cruiser: 6 } },
    ]);
    state = run(state, 30);
    expect(army(state, 'red-fleet')).toBeUndefined();
  });
});

describe('ports and training', () => {
  it('builds ports only in coastal provinces', () => {
    const state = game([{ id: 'blue-1', owner: 'blue', location: 'blueland', units: { infantry: 1 } }]);
    const noPort = structuredClone(state);
    noPort.provinces.find((p) => p.id === 'redport')!.buildings = [];
    expect(isCoastal(state, 'redport')).toBe(true);
    expect(isCoastal(state, 'redland')).toBe(false);
    expect(isCoastal(state, 'sea1')).toBe(false);
    expect(orderBuild(noPort, rules, 'red', 'redland', 'port')).toEqual({ ok: false, error: 'not_coastal' });
    expect(orderBuild(noPort, rules, 'red', 'redport', 'port').ok).toBe(true);
  });

  it('trains ships in a port as a fleet, apart from the land garrison', () => {
    let state = game([{ id: 'troops', owner: 'red', location: 'redport', units: { infantry: 5 } }]);
    state = ok(orderRecruit(state, rules, 'red', 'redport', 'transport', 2)).state;
    state = run(state, 5);
    const fleet = state.armies.find((a) => a.units.transport !== undefined);
    expect(fleet?.units).toEqual({ transport: 2 });
    expect(army(state, 'troops')?.units).toEqual({ infantry: 5 });
  });
});

describe('victory counts land provinces only', () => {
  it('lets a player win by owning 60% of the LAND provinces', () => {
    const state = createGame({
      map: seaMap,
      rules: baseRuleset, // 60% of 4 land provinces = 3
      players,
      owners: { redland: 'red', redport: 'red', bluecoast: 'red', blueland: 'blue' },
      armies: [{ id: 'blue-1', owner: 'blue', location: 'blueland', units: { infantry: 1 } }],
    });
    // 3 of 4 land provinces (but only 3 of 6 provinces overall).
    expect(tick(state, baseRuleset).outcome).toMatchObject({ winner: 'red', reason: 'domination' });
  });
});

describe('createGame validation', () => {
  const base = {
    map: seaMap,
    rules,
    players,
    owners: { redland: 'red', bluecoast: 'blue' },
  };

  it('rejects owned sea provinces and buildings at sea', () => {
    expect(() => createGame({ ...base, owners: { sea1: 'red' }, armies: [] })).toThrow(/Sea province/);
    expect(() => createGame({ ...base, armies: [], buildings: [{ provinceId: 'sea1', type: 'port' }] })).toThrow(/at sea/);
  });

  it('rejects land armies at sea and overloaded fleets', () => {
    const at = (units: Units) => [{ id: 'a', owner: 'red', location: 'sea1', units }];
    expect(() => createGame({ ...base, armies: at({ infantry: 3 }) })).toThrow(/no ships/);
    expect(() => createGame({ ...base, armies: at({ transport: 1, infantry: 11 }) })).toThrow(/more troops/);
    expect(() => createGame({ ...base, armies: at({ transport: 1, infantry: 10 }) })).not.toThrow();
  });

  it('rejects ships on land without a harbor', () => {
    const ships = [{ id: 'a', owner: 'red', location: 'redland', units: { cruiser: 1 } }];
    expect(() => createGame({ ...base, armies: ships })).toThrow(/harbor/);
  });
});

describe('generated maps with sea provinces', () => {
  const options = { seed: 7, width: 44, height: 30, provinceCount: 24 };

  it('keeps maps without sea provinces exactly as before', () => {
    const plain = generateHexMap(options);
    expect(generateHexMap({ ...options, seaProvinceCount: 0 })).toEqual(plain);
    expect(plain.provinces.every((p) => p.terrain === undefined)).toBe(true);
  });

  it('adds valid, deterministic sea provinces', () => {
    const map = generateHexMap({ ...options, seaProvinceCount: 8 });
    expect(validateHexMap(map)).toEqual([]);
    expect(generateHexMap({ ...options, seaProvinceCount: 8 })).toEqual(map);

    const sea = map.provinces.filter((p) => p.terrain === 'sea');
    expect(sea.length).toBeGreaterThan(0);
    expect(sea.every((p) => p.production === 0)).toBe(true);
    expect(map.provinces.filter((p) => p.terrain !== 'sea')).toHaveLength(24);

    // Coasts exist: some land province is linked to a sea province.
    const def = toMapDef(map);
    const seaIds = new Set(sea.map((p) => p.id));
    expect(def.edges.some((e) => seaIds.has(e.a) !== seaIds.has(e.b))).toBe(true);
  });

  it('starts a skirmish on land only, on one piece of land, and the AI can play it', () => {
    const map = generateHexMap({ ...options, seaProvinceCount: 8 });
    const def = toMapDef(map);
    const state = createSkirmish(map, def, baseRuleset, { players });
    const seaIds = new Set(def.provinces.filter((p) => p.terrain === 'sea').map((p) => p.id));
    for (const province of state.provinces) {
      if (seaIds.has(province.id)) expect(province.owner).toBeNull();
    }
    expect(state.armies.every((a) => !seaIds.has(a.location))).toBe(true);

    const end = runMatch(state, baseRuleset, { aiPlayers: ['red', 'blue'], maxTicks: 150 });
    expect(end.tick).toBeGreaterThan(0);
    expect(end.provinces.filter((p) => seaIds.has(p.id)).every((p) => p.owner === null)).toBe(true);
  });
});
