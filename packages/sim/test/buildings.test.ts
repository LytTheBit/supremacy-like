import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  duelMap,
  effectiveTrainingTicks,
  orderBuild,
  orderMove,
  orderRecruit,
  productionMultiplier,
  runAi,
  runMatch,
  tick,
  tinyMap,
  type GameState,
  type Ruleset,
} from '../src';

import { giveBuildings, withOffices } from './helpers';

const rules = baseRuleset;

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

function withStockpile(state: GameState, playerId: string, stock: Record<string, number>): GameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.id === playerId);
  if (!player) throw new Error('player not found');
  player.stockpile = { wood: 0, iron: 0, grain: 0, coal: 0, ...stock };
  return next;
}

function tiny(
  buildings: { provinceId: string; type: string }[] = [],
  extra: Partial<Parameters<typeof createGame>[0]> = {},
): GameState {
  const game = createGame({
    map: tinyMap,
    rules,
    players,
    owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' },
    armies: [],
    buildings,
    ...extra,
  });
  return withStockpile(withOffices(game), 'red', { wood: 20000, iron: 20000, coal: 20000, grain: 20000 });
}

function run(state: GameState, ticks: number, ruleset: Ruleset = rules): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, ruleset);
  return current;
}

function mustBuild(state: GameState, province: string, type: string, ruleset: Ruleset = rules): GameState {
  const result = orderBuild(state, ruleset, 'red', province, type);
  if (!result.ok) throw new Error(`build failed: ${result.error}`);
  return result.state;
}

describe('orderBuild', () => {
  it('pays the full cost immediately and queues the construction', () => {
    const state = mustBuild(tiny(), 'redhaven', 'barracks');
    const red = state.players.find((p) => p.id === 'red');

    // barracks cost 4000 wood + 2000 iron.
    expect(red?.stockpile).toMatchObject({ wood: 16000, iron: 18000, coal: 20000, grain: 20000 });
    expect(state.constructionQueue).toEqual([
      { id: expect.any(String), owner: 'red', provinceId: 'redhaven', buildingType: 'barracks', level: 1, ticksLeft: 3 },
    ]);
  });

  it('rejects invalid orders with a reason', () => {
    const state = tiny();
    const order = (player: string, province: string, type: string) => orderBuild(state, rules, player, province, type);

    expect(order('ghost', 'redhaven', 'barracks')).toEqual({ ok: false, error: 'player_not_found' });
    expect(order('red', 'atlantis', 'barracks')).toEqual({ ok: false, error: 'province_not_found' });
    expect(order('red', 'bluehaven', 'barracks')).toEqual({ ok: false, error: 'not_owner' });
    expect(order('red', 'redhaven', 'castle')).toEqual({ ok: false, error: 'unknown_building' });
    expect(order('red', 'westmark', 'recruitment_office')).toEqual({ ok: false, error: 'already_built' });

    const poor = withStockpile(state, 'red', { wood: 1 });
    expect(orderBuild(poor, rules, 'red', 'redhaven', 'barracks')).toEqual({
      ok: false,
      error: 'insufficient_resources',
    });
  });

  it('refuses a second construction of the same type in the same province', () => {
    const state = mustBuild(tiny(), 'redhaven', 'barracks');
    expect(orderBuild(state, rules, 'red', 'redhaven', 'barracks')).toEqual({
      ok: false,
      error: 'already_building',
    });
    // Another type, or the same type elsewhere, is fine.
    expect(orderBuild(state, rules, 'red', 'redhaven', 'railway').ok).toBe(true);
    expect(orderBuild(state, rules, 'red', 'westmark', 'barracks').ok).toBe(true);
  });

  it('refuses to build while an enemy army is in the province', () => {
    const state = tiny([], {
      armies: [{ id: 'b1', owner: 'blue', location: 'redhaven', units: { infantry: 1 } }],
    });
    expect(orderBuild(state, rules, 'red', 'redhaven', 'barracks')).toEqual({
      ok: false,
      error: 'enemy_present',
    });
  });

  it('never mutates the input state and rejects orders after the game is over', () => {
    const state = tiny();
    const snapshot = JSON.stringify(state);
    orderBuild(state, rules, 'red', 'redhaven', 'barracks');
    expect(JSON.stringify(state)).toBe(snapshot);

    const over = { ...state, outcome: { winner: 'red', winners: ['red'], reason: 'domination' as const } };
    expect(orderBuild(over, rules, 'red', 'redhaven', 'barracks')).toEqual({ ok: false, error: 'game_over' });
  });
});

describe('construction', () => {
  it('completes after the build time and adds the building to the province', () => {
    const ordered = mustBuild(tiny(), 'redhaven', 'barracks');

    const afterTwo = run(ordered, 2);
    expect(afterTwo.provinces.find((p) => p.id === 'redhaven')?.buildings).toEqual(['recruitment_office']);
    expect(afterTwo.constructionQueue).toHaveLength(1);

    const afterThree = run(ordered, 3);
    expect(afterThree.provinces.find((p) => p.id === 'redhaven')?.buildings).toEqual(['recruitment_office', 'barracks']);
    expect(afterThree.constructionQueue).toHaveLength(0);
    expect(afterThree.events).toContainEqual({
      tick: 3,
      type: 'building_completed',
      provinceId: 'redhaven',
      buildingType: 'barracks',
      level: 1,
    });
  });

  it('is lost if the province changes hands before completion', () => {
    const ordered = mustBuild(tiny(), 'redhaven', 'barracks');
    const taken = structuredClone(ordered);
    const province = taken.provinces.find((p) => p.id === 'redhaven');
    if (!province) throw new Error('province not found');
    province.owner = 'blue';

    const state = run(taken, 3);
    expect(state.provinces.find((p) => p.id === 'redhaven')?.buildings).toEqual(['recruitment_office']);
    expect(state.events.some((e) => e.type === 'building_cancelled')).toBe(true);
  });

  it('keeps standing buildings when the province is conquered', () => {
    const game = createGame({
      map: tinyMap,
      rules: { ...rules, victory: { provinceShare: 1 } },
      players,
      owners: { redhaven: 'red', westmark: 'red', eastmark: 'blue', bluehaven: 'blue' },
      armies: [{ id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 20 } }],
      buildings: [{ provinceId: 'eastmark', type: 'barracks' }],
    });
    const ordered = orderMove(game, 'red', 'r1', 'eastmark');
    if (!ordered.ok) throw new Error('order failed');

    const state = run(ordered.state, 3, { ...rules, victory: { provinceShare: 1 } });
    const eastmark = state.provinces.find((p) => p.id === 'eastmark');
    expect(eastmark?.owner).toBe('red');
    expect(eastmark?.buildings).toEqual(['barracks']);
  });
});

describe('building requirements and effects', () => {
  it('requires the building to train a unit that needs it', () => {
    const without = tiny();
    expect(orderRecruit(without, rules, 'red', 'redhaven', 'artillery', 1)).toEqual({
      ok: false,
      error: 'missing_building',
    });
    // Infantry needs a recruitment office (the fixture gives every province one).
    expect(orderRecruit(without, rules, 'red', 'redhaven', 'infantry', 1).ok).toBe(true);
    const bare = structuredClone(without);
    bare.provinces.find((p) => p.id === 'redhaven')!.buildings = [];
    expect(orderRecruit(bare, rules, 'red', 'redhaven', 'infantry', 1)).toEqual({ ok: false, error: 'missing_building' });

    const withFactory = tiny([{ provinceId: 'redhaven', type: 'factory' }]);
    expect(orderRecruit(withFactory, rules, 'red', 'redhaven', 'artillery', 1).ok).toBe(true);
    // The factory only helps in its own province.
    expect(orderRecruit(withFactory, rules, 'red', 'westmark', 'artillery', 1)).toEqual({
      ok: false,
      error: 'missing_building',
    });
  });

  it('shortens training time with a barracks, never below one tick', () => {
    const plain = tiny();
    const barracks = tiny([
      { provinceId: 'redhaven', type: 'barracks' },
      { provinceId: 'redhaven', type: 'factory' },
    ]);
    const province = (state: GameState) => {
      const p = state.provinces.find((x) => x.id === 'redhaven');
      if (!p) throw new Error('province not found');
      return p;
    };

    expect(effectiveTrainingTicks(rules, province(plain), 'infantry')).toBe(2);
    expect(effectiveTrainingTicks(rules, province(barracks), 'infantry')).toBe(1);
    expect(effectiveTrainingTicks(rules, province(barracks), 'artillery')).toBe(2);

    // Rounds up: 3 ticks at x0.5 is 2, and a huge reduction still takes 1 tick.
    const custom: Ruleset = {
      ...rules,
      units: { ...rules.units, slow: { ...rules.units.infantry!, trainingTicks: 3 }, fast: { ...rules.units.infantry!, trainingTicks: 1 } },
    };
    expect(effectiveTrainingTicks(custom, province(barracks), 'slow')).toBe(2);
    expect(effectiveTrainingTicks(custom, province(barracks), 'fast')).toBe(1);

    const ordered = orderRecruit(barracks, rules, 'red', 'redhaven', 'infantry', 2);
    if (!ordered.ok) throw new Error('recruit failed');
    expect(ordered.state.recruitQueue[0]?.ticksLeft).toBe(1);
  });

  it('boosts production with a workshop, and stacks multipliers', () => {
    const plain = run(tiny(), 2);
    const boosted = run(tiny([{ provinceId: 'redhaven', type: 'workshop' }]), 2);
    const grain = (state: GameState) => state.players.find((p) => p.id === 'red')?.stockpile.grain ?? 0;

    // redhaven makes 3000 grain per tick: +50% means 4500 per tick.
    expect(grain(plain)).toBe(20000 + 3000 * 2);
    expect(grain(boosted)).toBe(20000 + 4500 * 2);

    const stacked: Ruleset = {
      ...rules,
      buildings: { ...rules.buildings, granary: { name: 'Granary', cost: {}, buildTicks: 1, productionMultiplier: 2 } },
    };
    const state = createGame({
      map: tinyMap,
      rules: stacked,
      players,
      owners: { redhaven: 'red', bluehaven: 'blue' },
      armies: [],
      buildings: [
        { provinceId: 'redhaven', type: 'workshop' },
        { provinceId: 'redhaven', type: 'granary' },
      ],
    });
    const redhaven = state.provinces.find((p) => p.id === 'redhaven');
    if (!redhaven) throw new Error('province not found');
    expect(productionMultiplier(stacked, redhaven)).toBe(3);
  });
});

describe('createGame building validation', () => {
  const make = (buildings: { provinceId: string; type: string }[], ruleset: Ruleset = rules) =>
    createGame({ map: tinyMap, rules: ruleset, players, owners: {}, armies: [], buildings });

  it('rejects unknown or duplicate starting buildings', () => {
    expect(() => make([{ provinceId: 'nowhere', type: 'barracks' }])).toThrow(/unknown province/);
    expect(() => make([{ provinceId: 'redhaven', type: 'castle' }])).toThrow(/Unknown building/);
    expect(() =>
      make([
        { provinceId: 'redhaven', type: 'barracks' },
        { provinceId: 'redhaven', type: 'barracks' },
      ]),
    ).toThrow(/Duplicate/);
  });

  it('checks that the ruleset is consistent', () => {
    const badCost: Ruleset = {
      ...rules,
      buildings: { ...rules.buildings, bad: { name: 'Bad', cost: { gold: 1 }, buildTicks: 1 } },
    };
    expect(() => make([], badCost)).toThrow(/unknown resource/);

    const badRequirement: Ruleset = {
      ...rules,
      units: { ...rules.units, odd: { ...rules.units.infantry!, requires: { castle: 1 } } },
    };
    expect(() => make([], badRequirement)).toThrow(/requires unknown building/);
  });
});

describe('AI buildings', () => {
  const owners = {
    rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
    bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
  };
  const guard = { id: 'b-guard', owner: 'blue', location: 'bcap', units: { infantry: 1 } };

  function duel(buildings: { provinceId: string; type: string }[] = [], stock = { wood: 20000, iron: 20000, coal: 20000, grain: 0 }) {
    const game = withOffices(createGame({ map: duelMap, rules, players, owners, armies: [guard], buildings }));
    return withStockpile(game, 'red', stock);
  }

  const queuedTypes = (state: GameState) => state.constructionQueue.map((j) => j.buildingType);

  it('builds a training booster first, then the unit-enabling building, then economy', () => {
    const first = runAi(duel(), rules, 'red');
    expect(queuedTypes(first)).toEqual(['barracks']);
    // The cost was paid: 4000 wood + 2000 iron.
    expect(first.players.find((p) => p.id === 'red')?.stockpile).toMatchObject({ wood: 16000, iron: 18000 });

    // Artillery needs a factory, which needs a workshop of level 2, which needs the barracks: the AI
    // walks up that chain one building at a time, in the province where it already started.
    const second = runAi(duel([{ provinceId: 'rcap', type: 'barracks' }]), rules, 'red');
    expect(queuedTypes(second)).toEqual(['workshop']);
    expect(second.constructionQueue[0]).toMatchObject({ provinceId: 'rcap', level: 1 });

    const workshop1 = giveBuildings(duel([{ provinceId: 'rcap', type: 'barracks' }]), 'rcap', { workshop: 1 });
    const upgrade = runAi(workshop1, rules, 'red');
    expect(queuedTypes(upgrade)).toEqual(['workshop']);
    expect(upgrade.constructionQueue[0]).toMatchObject({ provinceId: 'rcap', level: 2 });

    const workshop2 = giveBuildings(duel([{ provinceId: 'rcap', type: 'barracks' }]), 'rcap', { workshop: 2 });
    expect(queuedTypes(runAi(workshop2, rules, 'red'))).toEqual(['factory']);

    // With the whole chain in place, the next thing is an economy building in the most productive province.
    const third = runAi(
      giveBuildings(duel([{ provinceId: 'rcap', type: 'barracks' }, { provinceId: 'rcap', type: 'factory' }]), 'rcap', { workshop: 2 }),
      rules,
      'red',
      { airForce: false }, // the airfield has its own test (test/ai-fleet.test.ts)
    );
    expect(queuedTypes(third)).toEqual(['railway']);
    expect(third.constructionQueue[0]?.provinceId).toBe('rcap');
  });

  it('builds at most one thing per turn and only what it can afford', () => {
    expect(runAi(duel([], { wood: 0, iron: 0, coal: 0, grain: 0 }), rules, 'red').constructionQueue).toHaveLength(0);
    expect(runAi(duel(), rules, 'red').constructionQueue).toHaveLength(1);
  });

  it('respects the economy building limit', () => {
    const state = duel([
      { provinceId: 'rcap', type: 'barracks' },
      { provinceId: 'rcap', type: 'factory' },
      { provinceId: 'rcap', type: 'workshop' },
      { provinceId: 'rcap', type: 'railway' },
    ]);
    const noAir = { airForce: false };
    expect(runAi(state, rules, 'red', { ...noAir, maxEconomyBuildings: 1 }).constructionQueue).toHaveLength(0);
    expect(queuedTypes(runAi(state, rules, 'red', { ...noAir, maxEconomyBuildings: 2 }))).toEqual(['railway']);
  });

  it('trains artillery only where a factory stands', () => {
    const state = duel([{ provinceId: 'rwood', type: 'factory' }], { wood: 0, iron: 40000, coal: 40000, grain: 40000 });
    const artillery = runAi(state, rules, 'red').recruitQueue.filter((j) => j.unitType === 'artillery');
    expect(artillery).toHaveLength(1);
    expect(artillery[0]?.provinceId).toBe('rwood');
  });

  it('builds up its infrastructure during a match', () => {
    const state = duel([], { wood: 400000, iron: 400000, coal: 400000, grain: 400000 });
    // Blue is a wall nobody beats and nobody wins: the AI keeps building for the whole match.
    state.armies.push({ id: 'b-wall', owner: 'blue', location: 'bcap', units: { infantry: 5000 }, order: null });
    // No victory condition either.
    const endless: Ruleset = { ...rules, victory: { provinceShare: 1 } };
    const final = runMatch(state, endless, { aiPlayers: ['red'], maxTicks: 90 });
    const buildingsOf = (type: string) => final.provinces.filter((p) => p.owner === 'red' && p.buildings.includes(type));

    expect(buildingsOf('barracks').length).toBeGreaterThanOrEqual(1);
    expect(buildingsOf('factory').length).toBeGreaterThanOrEqual(1);
    expect(buildingsOf('workshop').length).toBeGreaterThanOrEqual(1);
    // The chain office -> barracks -> workshop 2 -> factory is built in one province, in order.
    const industrial = final.provinces.find((p) => p.owner === 'red' && p.buildings.includes('factory'));
    expect(industrial?.buildings).toEqual(expect.arrayContaining(['recruitment_office', 'barracks', 'workshop', 'factory']));
    expect(industrial?.buildingLevels?.workshop ?? 1).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    const play = () => runMatch(duel(), rules, { aiPlayers: ['red', 'blue'], maxTicks: 40 });
    expect(play()).toEqual(play());
  });
});
