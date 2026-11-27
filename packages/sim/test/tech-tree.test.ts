import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  buildingLevel,
  createGame,
  damageReduction,
  duelMap,
  effectiveTrainingTicks,
  maxBuildingLevel,
  orderBuild,
  orderMove,
  orderRecruit,
  orderSpyMission,
  previewBattle,
  productionMultiplier,
  railBonus,
  runMatch,
  tick,
  viewFor,
  type Army,
  type GameState,
  type MapDef,
  type Ruleset,
  type Units,
} from '../src';
import { giveBuildings, withOffices } from './helpers';

const rules: Ruleset = { ...baseRuleset, victory: { provinceShare: 1 } };
const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

/** A road of four land provinces, 2 apart, and a sea route: a - s1 - s2 - s3 - b. */
const map: MapDef = {
  id: 'tech',
  provinces: [
    ...['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, name: id, resource: 'grain', production: 1000 })),
    { id: 'a', name: 'a', resource: 'grain', production: 1000 },
    { id: 'b', name: 'b', resource: 'grain', production: 1000 },
    ...['s1', 's2', 's3'].map((id) => ({ id, name: id, terrain: 'sea' as const, resource: 'grain', production: 0 })),
  ],
  edges: [
    { a: 'p1', b: 'p2', distance: 2 },
    { a: 'p2', b: 'p3', distance: 2 },
    { a: 'p3', b: 'p4', distance: 2 },
    { a: 'a', b: 's1', distance: 1 },
    { a: 's1', b: 's2', distance: 1 },
    { a: 's2', b: 's3', distance: 1 },
    { a: 's3', b: 'b', distance: 1 },
  ],
};

function make(
  owners: Record<string, string>,
  armies: { id: string; owner: string; location: string; units: Units }[] = [],
  ruleset: Ruleset = rules,
  mapDef: MapDef = map,
): GameState {
  const game = withOffices(createGame({ map: mapDef, rules: ruleset, players, owners, armies }));
  for (const player of game.players) player.stockpile = { money: 0, wood: 500000, iron: 500000, coal: 500000, grain: 500000 };
  return game;
}

const run = (state: GameState, ticks: number, ruleset: Ruleset = rules) => {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, ruleset);
  return current;
};

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('building levels', () => {
  it('upgrades a building one level at a time, paying each step', () => {
    let state = make({ p1: 'red', p4: 'blue' });
    state = must(orderBuild(state, rules, 'red', 'p1', 'barracks')).state;
    state = run(state, 3);
    const province = () => state.provinces.find((p) => p.id === 'p1')!;
    expect(buildingLevel(province(), 'barracks')).toBe(1);

    const before = state.players[0]!.stockpile.wood!;
    state = must(orderBuild(state, rules, 'red', 'p1', 'barracks')).state;
    // Level 2 costs 6000 wood + 3000 iron and takes 4 ticks.
    expect(state.players[0]!.stockpile.wood).toBe(before - 6000);
    expect(state.constructionQueue[0]).toMatchObject({ buildingType: 'barracks', level: 2, ticksLeft: 4 });
    // The upgrade is a construction: only one at a time per building.
    expect(orderBuild(state, rules, 'red', 'p1', 'barracks')).toEqual({ ok: false, error: 'already_building' });

    state = run(state, 4);
    expect(buildingLevel(province(), 'barracks')).toBe(2);
    expect(province().buildings.filter((b) => b === 'barracks')).toHaveLength(1);
    expect(state.events).toContainEqual({ tick: 7, type: 'building_completed', provinceId: 'p1', buildingType: 'barracks', level: 2 });

    state = run(must(orderBuild(state, rules, 'red', 'p1', 'barracks')).state, 5);
    expect(buildingLevel(province(), 'barracks')).toBe(3);
    // Level 3 is the top: nothing more to build.
    expect(orderBuild(state, rules, 'red', 'p1', 'barracks')).toEqual({ ok: false, error: 'already_built' });
  });

  it('applies the effects of the current level, inheriting what an upgrade does not state', () => {
    const state = make({ p1: 'red', p4: 'blue' });
    giveBuildings(state, 'p1', { barracks: 1, workshop: 3, factory: 4 });
    const p1 = state.provinces.find((p) => p.id === 'p1')!;
    // Workshop 1.7 x factory 1.25.
    expect(productionMultiplier(rules, p1)).toBeCloseTo(1.7 * 1.25);
    // A unit of 5 ticks at barracks level 1 (x0.5) takes 3; the barracks of level 3 (x0.33) takes 2.
    expect(effectiveTrainingTicks(rules, p1, 'tank')).toBe(3);
    giveBuildings(state, 'p1', { barracks: 3 });
    expect(effectiveTrainingTicks(rules, p1, 'tank')).toBe(2);
    // Railway has a single level and keeps its multiplier.
    giveBuildings(state, 'p1', { railway: 1 });
    expect(productionMultiplier(rules, p1)).toBeCloseTo(1.7 * 1.25 * 1.1);
    expect(maxBuildingLevel(rules.buildings.fortress!)).toBe(5);
  });

  it('keeps the chain: office -> barracks -> workshop -> factory', () => {
    let state = make({ p1: 'red', p4: 'blue' });
    const bare = (type: string) => orderBuild(state, rules, 'red', 'p1', type);
    expect(bare('workshop')).toEqual({ ok: false, error: 'missing_prerequisite' });
    expect(bare('factory')).toEqual({ ok: false, error: 'missing_prerequisite' });
    expect(bare('fortress')).toEqual({ ok: false, error: 'missing_prerequisite' });
    expect(bare('barracks').ok).toBe(true);
    // The railway, port and airfield have no prerequisite.
    expect(bare('railway').ok).toBe(true);

    state = giveBuildings(state, 'p1', { barracks: 1, workshop: 1 });
    // A factory needs a workshop of level 2.
    expect(bare('factory')).toEqual({ ok: false, error: 'missing_prerequisite' });
    state = giveBuildings(state, 'p1', { workshop: 2 });
    expect(bare('factory').ok).toBe(true);

    // The upper factory levels need a workshop of level 3.
    state = giveBuildings(state, 'p1', { factory: 2 });
    expect(bare('factory')).toEqual({ ok: false, error: 'missing_prerequisite' });
    state = giveBuildings(state, 'p1', { workshop: 3 });
    expect(bare('factory').ok).toBe(true);
  });

  it('is consistent: every building can be reached from nothing, and no unit asks for the impossible', () => {
    const reachable = (type: string, seen: string[] = []): boolean => {
      if (seen.includes(type)) return false;
      const def = rules.buildings[type]!;
      return [def, ...(def.upgrades ?? [])].every((step) =>
        Object.keys(step.requires ?? {}).every((needed) => reachable(needed, [...seen, type])),
      );
    };
    for (const type of Object.keys(rules.buildings)) expect([type, reachable(type)]).toEqual([type, true]);
    for (const [type, def] of Object.entries(rules.units)) {
      for (const [needed, level] of Object.entries(def.requires ?? {})) {
        expect([type, needed, level <= maxBuildingLevel(rules.buildings[needed]!)]).toEqual([type, needed, true]);
      }
    }
  });

  it('refuses rulesets with impossible requirements or levels', () => {
    const bad = (patch: (r: Ruleset) => void) => {
      const copy = structuredClone(rules);
      patch(copy);
      return () => createGame({ map, rules: copy, players, owners: {}, armies: [] });
    };
    expect(bad((r) => (r.units.tank!.requires = { factory: 9 }))).toThrow(/impossible level/);
    expect(bad((r) => (r.buildings.barracks!.requires = { castle: 1 }))).toThrow(/unknown building/);
    expect(bad((r) => (r.buildings.barracks!.requires = { barracks: 1 }))).toThrow(/itself/);
    expect(bad((r) => (r.buildings.fortress!.damageReduction = 2))).toThrow(/damageReduction/);
    expect(bad((r) => (r.units.fighter!.railOnly = true))).toThrow(/railOnly/);
    expect(bad((r) => (r.startingBuildings = ['castle']))).toThrow(/startingBuildings/);
  });
});

describe('unlocking the new units', () => {
  const recruit = (levels: Record<string, number>, unit: string, province = 'p1') => {
    const state = make({ p1: 'red', p4: 'blue', a: 'red' });
    giveBuildings(state, province, levels);
    return orderRecruit(state, rules, 'red', province, unit, 1);
  };
  const missing = { ok: false, error: 'missing_building' };

  it('follows the requirements of the atlas', () => {
    // Cavalry: office + barracks + workshop.
    expect(recruit({ barracks: 1 }, 'cavalry')).toEqual(missing);
    expect(recruit({ barracks: 1, workshop: 1 }, 'cavalry').ok).toBe(true);
    // Armored car: a workshop.
    expect(recruit({}, 'armored_car')).toEqual(missing);
    expect(recruit({ workshop: 1 }, 'armored_car').ok).toBe(true);
    // Balloon: a workshop of level 2.
    expect(recruit({ workshop: 1 }, 'balloon')).toEqual(missing);
    expect(recruit({ workshop: 2 }, 'balloon').ok).toBe(true);
    // Artillery: factory 1, tank: factory 2, heavy tank: factory 4.
    expect(recruit({ factory: 1 }, 'artillery').ok).toBe(true);
    expect(recruit({ factory: 1 }, 'tank')).toEqual(missing);
    expect(recruit({ factory: 2 }, 'tank').ok).toBe(true);
    expect(recruit({ factory: 3 }, 'heavy_tank')).toEqual(missing);
    expect(recruit({ factory: 4 }, 'heavy_tank').ok).toBe(true);
    // Railway gun: factory 3 and a railway in the province.
    expect(recruit({ factory: 3 }, 'railway_gun')).toEqual(missing);
    expect(recruit({ railway: 1 }, 'railway_gun')).toEqual(missing);
    expect(recruit({ factory: 3, railway: 1 }, 'railway_gun').ok).toBe(true);
    // Submarine: a port (coastal province) and a factory of level 2.
    expect(recruit({ port: 1 }, 'submarine', 'a')).toEqual(missing);
    expect(recruit({ port: 1, factory: 2 }, 'submarine', 'a').ok).toBe(true);
  });

  it('keeps infantry behind the recruitment office', () => {
    const state = make({ p1: 'red', p4: 'blue' });
    state.provinces.find((p) => p.id === 'p1')!.buildings = [];
    expect(orderRecruit(state, rules, 'red', 'p1', 'infantry', 1)).toEqual(missing);
  });

  it('trains and merges the new land units into one army', () => {
    const state = make({ p1: 'red', p4: 'blue' });
    giveBuildings(state, 'p1', { barracks: 1, workshop: 2, factory: 2 });
    let current = state;
    for (const unit of ['cavalry', 'armored_car', 'tank', 'balloon']) {
      current = must(orderRecruit(current, rules, 'red', 'p1', unit, 2)).state;
    }
    current = run(current, 6);
    const army = current.armies.find((a) => a.owner === 'red')!;
    expect(Object.keys(army.units).sort()).toEqual(['armored_car', 'balloon', 'cavalry', 'tank']);
  });
});

describe('fortress', () => {
  const fight = (fortress: number) => {
    // Blue attacks the home province of red, whose equal army stands behind a fortress.
    let state = make({ p1: 'red', p2: 'red', p4: 'blue' }, [
      { id: 'r', owner: 'red', location: 'p2', units: { infantry: 20 } },
      { id: 'b', owner: 'blue', location: 'p3', units: { infantry: 20 } },
    ]);
    if (fortress > 0) giveBuildings(state, 'p2', { barracks: 1, fortress });
    state = must(orderMove(state, 'blue', 'b', 'p2', rules)).state;
    state = run(state, 4); // the attackers arrive on tick 2 and fight for three rounds
    const left = (id: string) => state.armies.find((a) => a.id === id)?.units.infantry ?? 0;
    return { red: left('r'), blue: left('b') };
  };

  it('reads its protection from the level, and the best building counts', () => {
    const state = make({ p1: 'red', p4: 'blue' });
    const p1 = state.provinces.find((p) => p.id === 'p1')!;
    expect(damageReduction(rules, p1)).toBe(0);
    for (const [level, share] of [[1, 0.5], [2, 0.6], [3, 0.7], [4, 0.8], [5, 0.9]] as const) {
      giveBuildings(state, 'p1', { barracks: 1, fortress: level });
      expect(damageReduction(rules, p1)).toBeCloseTo(share);
    }
  });

  it('protects the troops of the owner when the province is attacked', () => {
    const open = fight(0);
    const level1 = fight(1);
    const level5 = fight(5);
    // Without a fortress it is an even fight; with one the defenders lose less and the attackers more.
    expect(open.red).toBeCloseTo(open.blue, 6);
    expect(level1.red).toBeGreaterThan(level1.blue);
    expect(level5.red).toBeGreaterThan(level1.red);
    expect(level5.blue).toBeLessThan(level1.blue);
  });

  it('does not protect the attacker, and not anybody on neutral ground', () => {
    // Red attacks p3, which belongs to blue and has the fortress: red gets no shelter in its own province.
    let state = make({ p1: 'red', p2: 'red', p3: 'blue', p4: 'blue' }, [
      { id: 'r', owner: 'red', location: 'p2', units: { infantry: 20 } },
      { id: 'b', owner: 'blue', location: 'p3', units: { infantry: 20 } },
    ]);
    giveBuildings(state, 'p2', { barracks: 1, fortress: 5 }); // red's own fortress, but the fight is at p3
    state = must(orderMove(state, 'red', 'r', 'p3', rules)).state;
    state = run(state, 2);
    const left = (id: string) => state.armies.find((a) => a.id === id)?.units.infantry ?? 0;
    expect(left('r')).toBeCloseTo(left('b'), 6);
  });

  it('is part of the battle calculator', () => {
    const attacker = { infantry: 20 };
    const defender = { infantry: 20 };
    const plain = previewBattle(rules, attacker, defender);
    const walled = previewBattle(rules, attacker, defender, 1000, 0.3);
    expect(plain.defenderHpLeft).toBeCloseTo(plain.attackerHpLeft, 6);
    expect(walled.winner).toBe('defender');
    expect(walled.defenderHpLeft).toBeGreaterThan(plain.defenderHpLeft);
  });

  it('is destroyed level by level by sabotage', () => {
    const state = make({ p1: 'red', p4: 'blue' });
    giveBuildings(state, 'p4', { barracks: 1, fortress: 3 });
    state.spies.push({ id: 'spy-1', owner: 'red', provinceId: 'p4', infiltrationLeft: 0, coverLeft: 30, mission: null });
    let current = must(orderSpyMission(state, rules, 'red', 'spy-1', { kind: 'sabotage', buildingType: 'fortress' })).state;
    current = run(current, rules.espionage!.sabotage.ticks);
    const p4 = current.provinces.find((p) => p.id === 'p4')!;
    expect(buildingLevel(p4, 'fortress')).toBe(2);
    expect(current.events.some((e) => e.type === 'building_sabotaged')).toBe(true);

    // A building with a single level is destroyed outright.
    giveBuildings(current, 'p4', { railway: 1 });
    current.spies.push({ id: 'spy-2', owner: 'red', provinceId: 'p4', infiltrationLeft: 0, coverLeft: 30, mission: null });
    current = run(must(orderSpyMission(current, rules, 'red', 'spy-2', { kind: 'sabotage', buildingType: 'railway' })).state, 4);
    expect(current.provinces.find((p) => p.id === 'p4')!.buildings).not.toContain('railway');
  });
});

describe('railway', () => {
  const marcher = (units: Units): Army => ({ id: 'r', owner: 'red', location: 'p1', units, order: null });

  /** Ticks an infantry army needs to walk from p1 to `to`, with railways in the given provinces. */
  const walk = (to: string, railways: string[], owners: Record<string, string> = { p1: 'red', p2: 'red', p3: 'red', p4: 'red' }) => {
    let state = make({ ...owners, a: 'blue' }, [marcher({ infantry: 5 })]);
    for (const id of railways) giveBuildings(state, id, { railway: 1 });
    state = must(orderMove(state, 'red', 'r', to, rules)).state;
    for (let t = 1; t <= 12; t++) {
      state = tick(state, rules);
      if (state.armies.find((a) => a.id === 'r')?.location === to) return t;
    }
    return Infinity;
  };

  it('makes troops faster between two railways', () => {
    // Infantry covers 1 per tick and every road is 2 long: 2 ticks, or 1 tick between two railways (factor 2).
    expect(walk('p2', [])).toBe(2);
    expect(walk('p2', ['p1', 'p2'])).toBe(1);
  });

  it('gives the bonus on the half of the road that lies in a province with a railway', () => {
    // p1 -> p4 is 6 long. Full network: 3 ticks. Railway only in p2 and p3: the road p1-p2 and p3-p4 are
    // half fast (1.5 each) and p2-p3 is fully fast (1): 4 ticks. No railway: 6 ticks.
    expect(walk('p4', [])).toBe(6);
    expect(walk('p4', ['p1', 'p2', 'p3', 'p4'])).toBe(3);
    expect(walk('p4', ['p2', 'p3'])).toBe(4);
    // The network ends at p2: p1-p2 is fully fast (1), p2-p3 half fast (1.5), p3-p4 normal (2): 4.5 -> 5 ticks.
    expect(walk('p4', ['p1', 'p2'])).toBe(5);
  });

  it('follows the position of the army: a province that owns more of the road gives more of its bonus', () => {
    // p1 holds 80% of the road p1-p2 (it is big). With a railway only in p1 the army is fast for the
    // first 1.6 of the 2 units; with it only in p2 it is fast for the last 0.4 only.
    const uneven: MapDef = { ...map, edges: map.edges.map((e) => (e.a === 'p1' && e.b === 'p2' ? { ...e, split: 0.8 } : e)) };
    const progressAfterOneTick = (railway: string) => {
      let state = make({ p1: 'red', p2: 'red', p3: 'red', p4: 'red', a: 'blue' }, [marcher({ infantry: 5 })], rules, uneven);
      giveBuildings(state, railway, { railway: 1 });
      state = must(orderMove(state, 'red', 'r', 'p2', rules)).state;
      return tick(state, rules).armies.find((a) => a.id === 'r')!.order?.progress;
    };
    // 0.8 of a tick for the first 1.6 (rate 2), then 0.2 of a tick at rate 1: 1.8 along the road.
    expect(progressAfterOneTick('p1')).toBeCloseTo(1.8);
    // Without a railway in the first part the army walks 1 per tick: 1.0 along the road.
    expect(progressAfterOneTick('p2')).toBeCloseTo(1.0);
  });

  it('notices a railway built in the middle of a march, and one that is lost', () => {
    const owners = { p1: 'red', p2: 'red', p3: 'red', p4: 'red', a: 'blue' };
    const march = (change: (s: GameState) => void) => {
      let state = make(owners, [marcher({ infantry: 5 })]);
      state = must(orderMove(state, 'red', 'r', 'p4', rules)).state;
      state = tick(state, rules); // one tick of walking, 1 of 6
      change(state);
      for (let t = 2; t <= 12; t++) {
        state = tick(state, rules);
        if (state.armies.find((a) => a.id === 'r')?.location === 'p4') return t;
      }
      return Infinity;
    };
    const everywhere = (s: GameState) => ['p1', 'p2', 'p3', 'p4'].forEach((id) => giveBuildings(s, id, { railway: 1 }));
    expect(march(() => {})).toBe(6);
    // Built after the first tick: the remaining 5 units go at double speed (2.5 ticks): done on tick 4.
    expect(march(everywhere)).toBe(4);
    // A railway network that stands from the start and is lost after one tick: 2 units done, 4 to go.
    let lost = make(owners, [marcher({ infantry: 5 })]);
    everywhere(lost);
    lost = tick(must(orderMove(lost, 'red', 'r', 'p4', rules)).state, rules);
    for (const p of lost.provinces) p.buildings = p.buildings.filter((b) => b !== 'railway');
    let ticks = 1;
    while (lost.armies.find((a) => a.id === 'r')?.location !== 'p4' && ticks < 12) {
      lost = tick(lost, rules);
      ticks++;
    }
    expect(ticks).toBe(5);
  });

  it('works for allied territory and for the border of one\'s own, but not in enemy territory', () => {
    const state = make({ p1: 'red', p2: 'blue', p3: 'red', p4: 'red', a: 'red' }, [marcher({ infantry: 5 })]);
    giveBuildings(state, 'p1', { railway: 1 });
    giveBuildings(state, 'p2', { railway: 1 });
    const p1 = state.provinces.find((p) => p.id === 'p1')!;
    const p2 = state.provinces.find((p) => p.id === 'p2')!;
    expect(railBonus(state, rules, 'red', p1)).toBe(2);
    expect(railBonus(state, rules, 'red', p2)).toBe(1); // the railway of an enemy is no use
    state.relations.push({ a: 'blue', b: 'red', kind: 'alliance' });
    expect(railBonus(state, rules, 'red', p2)).toBe(2);
    // Only the owner and allies: blue's troops do not use red's railway.
    state.relations.pop();
    expect(railBonus(state, rules, 'blue', p1)).toBe(1);
  });

  it('is the only way for railway guns', () => {
    const state = make({ p1: 'red', p2: 'red', p3: 'red', p4: 'blue' }, [marcher({ railway_gun: 1 })]);
    giveBuildings(state, 'p1', { railway: 1 });
    giveBuildings(state, 'p2', { railway: 1 });
    expect(orderMove(state, 'red', 'r', 'p2', rules).ok).toBe(true);
    expect(orderMove(state, 'red', 'r', 'p3', rules)).toEqual({ ok: false, error: 'no_path' });
    giveBuildings(state, 'p3', { railway: 1 });
    expect(orderMove(state, 'red', 'r', 'p3', rules).ok).toBe(true);
    // A mixed army is as limited as its gun.
    const mixed = structuredClone(state);
    mixed.armies[0]!.units = { railway_gun: 1, infantry: 4 };
    mixed.provinces.find((p) => p.id === 'p3')!.buildings = [];
    expect(orderMove(mixed, 'red', 'r', 'p3', rules)).toEqual({ ok: false, error: 'no_path' });
  });
});

describe('balloon', () => {
  it('sees far and, as a land unit, takes an undefended province', () => {
    expect(rules.units.balloon!.vision).toBeGreaterThan(rules.units.infantry!.vision!);
    const alone = run(
      make({ p1: 'red', p4: 'blue' }, [{ id: 'r', owner: 'red', location: 'p2', units: { balloon: 2 } }]),
      1,
    );
    expect(alone.provinces.find((p) => p.id === 'p2')!.owner).toBe('red');
  });
});

describe('submarine', () => {
  it('is hidden from enemies that are not close, unlike other ships', () => {
    const state = make({ a: 'red', b: 'blue' }, [
      { id: 'sub', owner: 'red', location: 's2', units: { submarine: 2 } },
      { id: 'cr', owner: 'red', location: 's2', units: { cruiser: 1 } },
    ]);
    giveBuildings(state, 'a', { port: 1 });
    const blueSees = (s: GameState) => viewFor(s, rules, 'blue').state.armies.map((x) => x.id);
    // Blue's province b sees s2 (distance 2), but the submarine only shows within 1.
    expect(blueSees(state)).toContain('cr');
    expect(blueSees(state)).not.toContain('sub');

    // A blue ship next to it spots it.
    const close = structuredClone(state);
    close.armies.push({ id: 'bsh', owner: 'blue', location: 's3', units: { cruiser: 1 }, order: null });
    expect(blueSees(close)).toContain('sub');
    // The owner always sees its own.
    expect(viewFor(state, rules, 'red').state.armies.map((x) => x.id)).toContain('sub');
    // A submarine mixed with other ships is not hidden.
    const mixed = structuredClone(state);
    mixed.armies.find((x) => x.id === 'sub')!.units = { submarine: 1, cruiser: 1 };
    expect(blueSees(mixed)).toContain('sub');
  });

  it('hurts ships but not troops on land', () => {
    // Against a cruiser it fights; against land troops its attack counts for nothing.
    const vsShip = previewBattle(rules, { submarine: 3 }, { cruiser: 2 });
    const vsLand = previewBattle(rules, { submarine: 3 }, { infantry: 3 });
    expect(vsShip.attackerHpLeft).toBeLessThan(1);
    expect(vsShip.defenderHpLeft).toBeLessThan(1);
    expect(vsLand.defenderHpLeft).toBe(1);
  });
});

describe('AI with the new units around', () => {
  it('plays a whole match against an army full of new units without breaking', () => {
    const owners = {
      rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
      bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
    };
    const modern: Units = { infantry: 5, cavalry: 4, armored_car: 3, tank: 3, heavy_tank: 1, railway_gun: 1, balloon: 2 };
    const start = () =>
      withOffices(
        createGame({
          map: duelMap,
          rules,
          players,
          owners,
          armies: [
            { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 8 } },
            { id: 'b1', owner: 'blue', location: 'bcap', units: modern },
          ],
        }),
      );
    const a = runMatch(start(), rules, { aiPlayers: ['red', 'blue'], maxTicks: 60 });
    const b = runMatch(start(), rules, { aiPlayers: ['red', 'blue'], maxTicks: 60 });
    expect(a).toEqual(b);
    expect(a.tick).toBeGreaterThan(10);
  });
});
