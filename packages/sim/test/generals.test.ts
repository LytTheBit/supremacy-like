import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  commanderBonus,
  composeRuleset,
  createGame,
  defaultMedals,
  duelMap,
  generalsMedal,
  orderRecruit,
  previewBattle,
  runAi,
  runMatch,
  rulesetWithMedals,
  sideStats,
  tick,
  tinyMap,
  type GameState,
  type Medal,
  type Ruleset,
} from '../src';

const base = baseRuleset;
const rules = rulesetWithMedals(base, ['generals']);

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

describe('medals', () => {
  it('adds the generals content without touching the base ruleset', () => {
    const snapshot = JSON.stringify(base);
    const composed = composeRuleset(base, [generalsMedal]);

    expect(JSON.stringify(base)).toBe(snapshot);
    expect(composed.id).toBe('base+generals');
    expect(composed.medals).toEqual(['generals']);
    expect(Object.keys(composed.units)).toEqual(expect.arrayContaining(['major', 'colonel', 'general']));
    expect(composed.buildings.military_academy).toBeDefined();

    // Without the medal there are no commanders at all.
    expect(base.medals).toEqual([]);
    expect(base.units.general).toBeUndefined();
    expect(base.buildings.military_academy).toBeUndefined();
  });

  it('builds a ruleset from medal ids and rejects unknown ones', () => {
    expect(rulesetWithMedals(base, ['generals'])).toEqual(composeRuleset(base, [generalsMedal]));
    expect(rulesetWithMedals(base, [])).toEqual(base);
    expect(() => rulesetWithMedals(base, ['telepathy'])).toThrow(/Unknown medal/);
    expect(defaultMedals.map((m) => m.id)).toContain('generals');
  });

  it('checks eras, duplicates, requirements and conflicts', () => {
    const noop = (r: Ruleset) => r;
    const medieval: Medal = { id: 'knights', name: 'K', description: '', eras: ['medieval'], apply: noop };
    const needsGenerals: Medal = { id: 'staff', name: 'S', description: '', requires: ['generals'], apply: noop };
    const clash: Medal = { id: 'militia', name: 'M', description: '', conflicts: ['generals'], apply: noop };

    expect(() => composeRuleset(base, [medieval])).toThrow(/not available in the ww1 era/);
    expect(() => composeRuleset(base, [generalsMedal, generalsMedal])).toThrow(/more than once/);
    expect(() => composeRuleset(base, [needsGenerals])).toThrow(/requires "generals"/);
    expect(composeRuleset(base, [generalsMedal, needsGenerals]).medals).toEqual(['generals', 'staff']);
    // Order matters: the required medal must come first.
    expect(() => composeRuleset(base, [needsGenerals, generalsMedal])).toThrow(/requires/);
    expect(() => composeRuleset(base, [generalsMedal, clash])).toThrow(/cannot be combined/);
  });

  it('gives each combination of medals its own ruleset id', () => {
    expect(rulesetWithMedals(base, []).id).toBe('base');
    expect(rulesetWithMedals(base, ['generals']).id).toBe('base+generals');
  });
});

describe('commander bonus', () => {
  const bonus = (units: Record<string, number>, ruleset: Ruleset = rules) => commanderBonus(ruleset, units);

  it('follows the design: 2% per major, 5% per colonel, 20% per general, each type capped at 20%', () => {
    expect(bonus({ infantry: 50, major: 1 })).toBeCloseTo(0.02, 10);
    expect(bonus({ infantry: 50, major: 5 })).toBeCloseTo(0.1, 10);
    expect(bonus({ infantry: 50, major: 10 })).toBeCloseTo(0.2, 10);
    expect(bonus({ infantry: 50, major: 11 })).toBeCloseTo(0.2, 10); // capped
    expect(bonus({ infantry: 50, colonel: 4 })).toBeCloseTo(0.2, 10);
    expect(bonus({ infantry: 50, colonel: 9 })).toBeCloseTo(0.2, 10); // capped
    expect(bonus({ infantry: 50, general: 1 })).toBeCloseTo(0.2, 10);
    expect(bonus({ infantry: 50, general: 3 })).toBeCloseTo(0.2, 10); // capped
  });

  it('adds up across types: 10 majors, 4 colonels and a general give +60%', () => {
    expect(bonus({ infantry: 100, major: 10, colonel: 4, general: 1 })).toBeCloseTo(0.6, 10);
  });

  it('is zero without commanders or without troops to lead', () => {
    expect(bonus({ infantry: 10 })).toBe(0);
    expect(bonus({ major: 5, general: 1 })).toBe(0);
    expect(bonus({})).toBe(0);
  });

  it('can be limited to a number of troops', () => {
    const limited: Ruleset = { ...rules, commanders: { maxAffectedTroops: 50 } };
    // 100 troops, only 50 benefit: half the bonus.
    expect(bonus({ infantry: 100, general: 1 }, limited)).toBeCloseTo(0.1, 10);
    // Fewer troops than the limit: full bonus.
    expect(bonus({ infantry: 40, general: 1 }, limited)).toBeCloseTo(0.2, 10);
  });

  it('is fractional-friendly: casualties reduce the bonus smoothly', () => {
    expect(bonus({ infantry: 50, major: 4.5 })).toBeCloseTo(0.09, 10);
  });
});

describe('commanders in combat', () => {
  it('multiplies attack and defense, not hit points', () => {
    const plain = sideStats(rules, { infantry: 10 });
    const led = sideStats(rules, { infantry: 10, general: 1 });

    expect(led.attack).toBeCloseTo(plain.attack * 1.2, 10);
    // The general adds 1 defense of its own, then everything is multiplied.
    expect(led.defense).toBeCloseTo((plain.defense + 1) * 1.2, 10);
    expect(led.hp).toBe(plain.hp + 10);
  });

  it('lets an army with a general beat an otherwise equal army', () => {
    const equal = previewBattle(rules, { infantry: 10 }, { infantry: 10 });
    expect(equal.winner).toBe('draw');

    const led = previewBattle(rules, { infantry: 10, general: 1 }, { infantry: 10 });
    expect(led.winner).toBe('attacker');
    const smaller = previewBattle(rules, { infantry: 10, major: 10 }, { infantry: 10 });
    expect(smaller.winner).toBe('attacker');
  });

  it('has no effect in a game without the medal', () => {
    expect(() => sideStats(base, { infantry: 10, general: 1 })).toThrow(/Unknown unit type/);
  });
});

describe('Military Academy and commanders in a game', () => {
  const make = (buildings: { provinceId: string; type: string }[] = [], ruleset: Ruleset = rules) =>
    withStockpile(
      createGame({
        map: tinyMap,
        rules: ruleset,
        players,
        owners: { redhaven: 'red', bluehaven: 'blue' },
        armies: [],
        buildings,
      }),
      'red',
      { wood: 99000, iron: 99000, grain: 99000, coal: 99000 },
    );

  it('requires an academy to train commanders', () => {
    expect(orderRecruit(make(), rules, 'red', 'redhaven', 'general', 1)).toEqual({
      ok: false,
      error: 'missing_building',
    });
    const withAcademy = make([{ provinceId: 'redhaven', type: 'military_academy' }]);
    expect(orderRecruit(withAcademy, rules, 'red', 'redhaven', 'general', 1).ok).toBe(true);
  });

  it('does not offer commanders without the medal', () => {
    const plain = make([], base);
    expect(orderRecruit(plain, base, 'red', 'redhaven', 'general', 1)).toEqual({
      ok: false,
      error: 'unknown_unit_type',
    });
  });

  it('trains commanders that join the army of their province', () => {
    const state = createGame({
      map: tinyMap,
      rules,
      players,
      owners: { redhaven: 'red', bluehaven: 'blue' },
      armies: [{ id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: 10 } }],
      buildings: [{ provinceId: 'redhaven', type: 'military_academy' }],
    });
    const ordered = orderRecruit(withStockpile(state, 'red', { grain: 99000, iron: 99000, coal: 99000 }), rules, 'red', 'redhaven', 'major', 2);
    if (!ordered.ok) throw new Error('recruit failed');

    let current = ordered.state;
    for (let i = 0; i < 3; i++) current = tick(current, rules);
    expect(current.armies).toHaveLength(1);
    expect(current.armies[0]?.units).toEqual({ infantry: 10, major: 2 });
    expect(commanderBonus(rules, current.armies[0]?.units ?? {})).toBeCloseTo(0.04, 10);
  });

  it('refuses to advance a game with a different ruleset than the one it was created with', () => {
    const state = make();
    expect(state.rulesId).toBe('base+generals');
    expect(() => tick(state, base)).toThrow(/Ruleset mismatch/);
    expect(() => tick(make([], base), rules)).toThrow(/Ruleset mismatch/);
    expect(() => tick(state, rules)).not.toThrow();
  });

  it('validates the medal content when creating the game', () => {
    const broken: Medal = {
      id: 'broken',
      name: 'Broken',
      description: '',
      apply: (r) => {
        r.units.ghost = { ...r.units.infantry!, requires: { castle: 1 } };
        return r;
      },
    };
    expect(() => make([], composeRuleset(base, [broken]))).toThrow(/requires unknown building/);
  });
});

describe('AI with generals', () => {
  const owners = {
    rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
    bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
  };
  const rich = { wood: 300000, iron: 300000, grain: 300000, coal: 300000 };

  function duel(
    redTroops: number,
    buildings: { provinceId: string; type: string }[] = [],
    ruleset: Ruleset = rules,
  ) {
    return withStockpile(
      createGame({
        map: duelMap,
        rules: ruleset,
        players,
        owners,
        armies: [
          { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: redTroops } },
          // A strong guard keeps the game going while red builds up.
          { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 200 } },
        ],
        buildings,
      }),
      'red',
      rich,
    );
  }

  const academy = [{ provinceId: 'rcap', type: 'military_academy' }];

  it('trains commanders once it has an army and an academy', () => {
    const next = runAi(duel(20, academy), rules, 'red');
    const commanders = next.recruitQueue.filter((j) => ['general', 'colonel', 'major'].includes(j.unitType));
    expect(commanders.length).toBeGreaterThan(0);
    // The strongest commander type is trained first.
    expect(commanders[0]?.unitType).toBe('general');
    expect(commanders.every((j) => j.count === 1)).toBe(true);
  });

  it('waits until it has enough troops', () => {
    const next = runAi(duel(3, academy), rules, 'red');
    expect(next.recruitQueue.some((j) => ['general', 'colonel', 'major'].includes(j.unitType))).toBe(false);
  });

  it('does not train more commanders than the maximum bonus needs', () => {
    const state = duel(20, academy);
    // Already has a general and the 4 colonels and 10 majors that reach each cap.
    const full = structuredClone(state);
    const army = full.armies.find((a) => a.id === 'r1');
    if (!army) throw new Error('army not found');
    army.units = { infantry: 20, general: 1, colonel: 4, major: 10 };

    const next = runAi(full, rules, 'red');
    expect(next.recruitQueue.some((j) => ['general', 'colonel', 'major'].includes(j.unitType))).toBe(false);
  });

  it('builds the academy by itself and ends up with commanders in a match', () => {
    // Conquering everything would end the game early: only total conquest wins here.
    const longGame: Ruleset = { ...rules, victory: { provinceShare: 1 } };
    const seen = new Set<string>();
    const final = runMatch(duel(20, [], longGame), longGame, {
      aiPlayers: ['red'],
      maxTicks: 60,
      onTick: (state) => {
        for (const army of state.armies) {
          if (army.owner !== 'red') continue;
          for (const [type, count] of Object.entries(army.units)) {
            if (count > 0 && rules.units[type]?.commander) seen.add(type);
          }
        }
      },
    });

    expect(final.provinces.some((p) => p.owner === 'red' && p.buildings.includes('military_academy'))).toBe(true);
    expect(seen.size).toBeGreaterThan(0);
  });

  it('plays a full AI vs AI match with the medal without errors', () => {
    const state = createGame({
      map: duelMap,
      rules,
      players,
      owners,
      armies: [
        { id: 'red-1', owner: 'red', location: 'rfront', units: { infantry: 12 } },
        { id: 'blue-1', owner: 'blue', location: 'bfront', units: { infantry: 6 } },
      ],
    });
    const final = runMatch(state, rules, { aiPlayers: ['red', 'blue'], maxTicks: 120 });
    expect(final.tick).toBeGreaterThan(0);
    expect(final.rulesId).toBe('base+generals');
  });
});
