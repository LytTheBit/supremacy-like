import { describe, expect, it } from 'vitest';
import {
  armyVision,
  baseRuleset,
  createGame,
  duelMap,
  isEventVisible,
  tick,
  viewFor,
  visibleProvinces,
  type GameEvent,
  type GameState,
  type Ruleset,
  type Units,
} from '../src';

const rules = baseRuleset;
const noFog: Ruleset = { ...rules, vision: { ...rules.vision, fog: false } };

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
  { id: 'green', name: 'Green' },
];

const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
};

type ArmySetup = { id: string; owner: string; location: string; units: Units };

function game(
  armies: ArmySetup[],
  extra: Partial<Parameters<typeof createGame>[0]> = {},
  ruleset: Ruleset = rules,
): GameState {
  return createGame({ map: duelMap, rules: ruleset, players, owners, armies, ...extra });
}

const redGuard: ArmySetup = { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } };
const blueGuard: ArmySetup = { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } };

describe('visibleProvinces', () => {
  it('sees owned provinces and the ones within the province radius', () => {
    const seen = visibleProvinces(game([redGuard, blueGuard]), rules, 'red');
    // Every red province, and nothing farther than 2.5 from them: mnorth is 3 from rfront.
    for (const id of ['rcap', 'riron', 'rwood', 'rcoal', 'rfront']) expect(seen.has(id)).toBe(true);
    expect(seen.has('mnorth')).toBe(false);
    expect(seen.has('msouth')).toBe(false);
    expect(seen.has('bcap')).toBe(false);
  });

  it('sees everything when the fog is off', () => {
    const seen = visibleProvinces(game([redGuard, blueGuard], {}, noFog), noFog, 'red');
    expect(seen.size).toBe(12);
  });

  it('extends vision with armies, by the best vision among their units', () => {
    const scout: ArmySetup = { id: 'r-scout', owner: 'red', location: 'mnorth', units: { infantry: 1 } };
    const seen = visibleProvinces(game([redGuard, blueGuard, scout]), rules, 'red');
    // Infantry sees 2.5: msouth is 2 away, bfront and rfront are 3 away (rfront is red anyway).
    expect(seen.has('mnorth')).toBe(true);
    expect(seen.has('msouth')).toBe(true);
    expect(seen.has('bfront')).toBe(false);
  });

  it('gives short-sighted units a shorter view', () => {
    expect(armyVision(rules, { infantry: 3 })).toBe(2.5);
    expect(armyVision(rules, { artillery: 3 })).toBe(1.5);
    expect(armyVision(rules, { infantry: 1, artillery: 3 })).toBe(2.5);
    expect(armyVision(rules, {})).toBe(0);
    expect(armyVision(rules, { infantry: 0 })).toBe(0);
    const custom: Ruleset = { ...rules, units: { ...rules.units, infantry: { ...rules.units.infantry!, vision: undefined } } };
    expect(armyVision(custom, { infantry: 1 })).toBe(rules.vision.unitRadius);
  });

  it('shares vision between allies, but not between truce partners', () => {
    const scout: ArmySetup = { id: 'g1', owner: 'green', location: 'mnorth', units: { infantry: 1 } };
    const base = { owners: { ...owners, mnorth: 'green' } };
    const allied = game([redGuard, blueGuard, scout], { ...base, relations: [{ a: 'green', b: 'red', kind: 'alliance' }] });
    const truce = game([redGuard, blueGuard, scout], { ...base, relations: [{ a: 'green', b: 'red', kind: 'truce' }] });
    const war = game([redGuard, blueGuard, scout], base);

    expect(visibleProvinces(allied, rules, 'red').has('msouth')).toBe(true);
    expect(visibleProvinces(truce, rules, 'red').has('msouth')).toBe(false);
    expect(visibleProvinces(war, rules, 'red').has('msouth')).toBe(false);
  });

  it('follows the armies and provinces as they change hands', () => {
    let state = game([redGuard, blueGuard, { id: 'r-scout', owner: 'red', location: 'mnorth', units: { infantry: 1 } }]);
    expect(visibleProvinces(state, rules, 'red').has('msouth')).toBe(true);
    state = { ...state, armies: state.armies.filter((a) => a.id !== 'r-scout') };
    expect(visibleProvinces(state, rules, 'red').has('msouth')).toBe(false);
  });
});

describe('viewFor', () => {
  const enemy: ArmySetup = { id: 'b-far', owner: 'blue', location: 'bfront', units: { infantry: 9 } };
  const near: ArmySetup = { id: 'b-near', owner: 'blue', location: 'rfront', units: { infantry: 3 } };

  it('hides armies out of sight but keeps own and visible ones', () => {
    const view = viewFor(game([redGuard, blueGuard, enemy, near]), rules, 'red');
    const ids = view.state.armies.map((a) => a.id).sort();
    expect(ids).toEqual(['b-near', 'r1']);
  });

  it('never hides own armies, wherever they are', () => {
    const far: ArmySetup = { id: 'r-far', owner: 'red', location: 'bcap', units: { infantry: 2 } };
    const view = viewFor(game([redGuard, blueGuard, far]), rules, 'red');
    expect(view.state.armies.some((a) => a.id === 'r-far')).toBe(true);
    // ...and it sees what stands next to it.
    expect(view.visible).toContain('bcap');
    expect(view.state.armies.some((a) => a.id === 'b1')).toBe(true);
  });

  it('keeps ownership public', () => {
    const view = viewFor(game([redGuard, blueGuard]), rules, 'red');
    expect(view.state.provinces.find((p) => p.id === 'bcap')?.owner).toBe('blue');
  });

  it('hides the stockpiles and queues of other players', () => {
    const state = game([redGuard, blueGuard], { stockpiles: { red: { grain: 5000 }, blue: { grain: 9000 } } });
    const withJobs: GameState = {
      ...state,
      recruitQueue: [
        { id: 'job-1', owner: 'red', provinceId: 'rcap', unitType: 'infantry', count: 1, ticksLeft: 2 },
        { id: 'job-2', owner: 'blue', provinceId: 'bcap', unitType: 'infantry', count: 1, ticksLeft: 2 },
      ],
      constructionQueue: [
        { id: 'build-3', owner: 'blue', provinceId: 'bcap', buildingType: 'barracks', ticksLeft: 2 },
      ],
    };
    const view = viewFor(withJobs, rules, 'red');
    expect(view.state.players.find((p) => p.id === 'red')?.stockpile.grain).toBe(5000);
    expect(view.state.players.find((p) => p.id === 'blue')?.stockpile).toEqual({});
    expect(view.state.recruitQueue.map((j) => j.id)).toEqual(['job-1']);
    expect(view.state.constructionQueue).toEqual([]);
  });

  it('shows allies their ally\'s stockpile and queues', () => {
    const state = game([redGuard, blueGuard], {
      stockpiles: { green: { grain: 7000 } },
      relations: [{ a: 'green', b: 'red', kind: 'alliance' }],
    });
    expect(viewFor(state, rules, 'red').state.players.find((p) => p.id === 'green')?.stockpile.grain).toBe(7000);
  });

  it('hides proposals between other players', () => {
    const state: GameState = {
      ...game([redGuard, blueGuard]),
      proposals: [
        { id: 'p1', from: 'blue', to: 'green', kind: 'truce', expiresAt: 9 },
        { id: 'p2', from: 'blue', to: 'red', kind: 'truce', expiresAt: 9 },
      ],
    };
    expect(viewFor(state, rules, 'red').state.proposals.map((p) => p.id)).toEqual(['p2']);
  });

  it('remembers the buildings and morale of provinces that go out of sight', () => {
    // Red sees bcap with an army there, and learns about its barracks.
    let state = game(
      [redGuard, blueGuard, { id: 'r-spy', owner: 'red', location: 'biron', units: { infantry: 1 } }],
      { buildings: [{ provinceId: 'bcap', type: 'barracks' }] },
    );
    let view = viewFor(state, rules, 'red');
    expect(view.visible).toContain('bcap');
    expect(view.state.provinces.find((p) => p.id === 'bcap')?.buildings).toEqual(['barracks']);

    // The spy leaves and blue builds a workshop: red still believes what it saw.
    state = structuredClone(state);
    state.armies = state.armies.filter((a) => a.id !== 'r-spy');
    state.provinces.find((p) => p.id === 'bcap')!.buildings.push('workshop');
    state.provinces.find((p) => p.id === 'bcap')!.morale = 12;
    view = viewFor(state, rules, 'red', view.memory);
    expect(view.visible).not.toContain('bcap');
    const known = view.state.provinces.find((p) => p.id === 'bcap');
    expect(known?.buildings).toEqual(['barracks']);
    expect(known?.morale).toBe(100);
    expect(view.memory.bcap?.tick).toBe(0);
  });

  it('shows nothing it never saw', () => {
    const state = game([redGuard, blueGuard], { buildings: [{ provinceId: 'bcap', type: 'barracks' }] });
    const view = viewFor(state, rules, 'red');
    const unknown = view.state.provinces.find((p) => p.id === 'bcap');
    expect(unknown?.buildings).toEqual([]);
    expect(unknown?.morale).toBe(rules.morale.start);
  });

  it('does not change the real state', () => {
    const state = game([redGuard, blueGuard, enemy]);
    const before = JSON.stringify(state);
    viewFor(state, rules, 'red');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('is a plain copy when the fog is off', () => {
    const state = game([redGuard, blueGuard, enemy], {}, noFog);
    const view = viewFor(state, noFog, 'red');
    expect(view.state).toEqual(state);
    expect(view.state).not.toBe(state);
    expect(view.visible).toHaveLength(12);
  });

  it('filters events about places the player cannot see', () => {
    const state: GameState = {
      ...game([redGuard, blueGuard]),
      events: [
        { tick: 1, type: 'battle', provinceId: 'bfront', owners: ['blue', 'green'] },
        { tick: 1, type: 'battle', provinceId: 'bfront', owners: ['blue', 'red'] },
        { tick: 1, type: 'army_destroyed', armyId: 'x', provinceId: 'bwood' },
        { tick: 1, type: 'province_conquered', provinceId: 'bwood', from: 'blue', to: 'green' },
        { tick: 1, type: 'building_completed', provinceId: 'rcap', buildingType: 'barracks' },
      ],
    };
    const types = viewFor(state, rules, 'red').state.events.map((e) => `${e.type}`);
    expect(types).toEqual(['battle', 'province_conquered', 'building_completed']);
  });
});

describe('isEventVisible', () => {
  const visible = new Set(['rcap']);
  const cases: [GameEvent, boolean][] = [
    [{ tick: 1, type: 'army_arrived', armyId: 'a', provinceId: 'rcap' }, true],
    [{ tick: 1, type: 'army_arrived', armyId: 'a', provinceId: 'bcap' }, false],
    [{ tick: 1, type: 'battle', provinceId: 'bcap', owners: ['red', 'blue'] }, true],
    [{ tick: 1, type: 'battle', provinceId: 'bcap', owners: ['blue', 'green'] }, false],
    [{ tick: 1, type: 'player_eliminated', playerId: 'blue' }, true],
    [{ tick: 1, type: 'proposal_made', proposalId: 'p', from: 'a', to: 'b', kind: 'truce' }, true],
  ];
  it.each(cases)('decides %j', (event, expected) => {
    expect(isEventVisible(event, visible, 'red')).toBe(expected);
  });
});

describe('fog in the rules', () => {
  it('validates the vision rules', () => {
    expect(() => game([redGuard, blueGuard], {}, { ...rules, vision: { ...rules.vision, provinceRadius: -1 } })).toThrow();
    expect(() => game([redGuard, blueGuard], {}, { ...rules, vision: { ...rules.vision, unitRadius: -1 } })).toThrow();
    expect(() =>
      game([redGuard, blueGuard], {}, { ...rules, units: { ...rules.units, infantry: { ...rules.units.infantry!, vision: -2 } } }),
    ).toThrow();
  });

  it('does not change how the game itself plays', () => {
    // The fog only decides what a player knows: the same orders give the same game.
    const armies = [redGuard, blueGuard];
    const a = tick(game(armies), rules);
    const b = tick(game(armies, {}, noFog), noFog);
    expect({ ...a, rulesId: '' }).toEqual({ ...b, rulesId: '' });
  });
});
