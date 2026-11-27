import { describe, expect, it } from 'vitest';
import {
  alliesOf,
  areAllied,
  areHostile,
  baseRuleset,
  createGame,
  orderDeclareWar,
  orderMove,
  orderPropose,
  orderRecruit,
  orderRespond,
  relationBetween,
  resolveRound,
  runAi,
  tick,
  tinyMap,
  type GameState,
  type Ruleset,
} from '../src';

import { withOffices } from './helpers';

const rules = baseRuleset;

const two = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];
const three = [...two, { id: 'green', name: 'Green' }];

type Setup = Parameters<typeof createGame>[0];

function game(extra: Partial<Setup> = {}, ruleset: Ruleset = rules): GameState {
  return withOffices(
    createGame({
      map: tinyMap,
      rules: ruleset,
      players: two,
      owners: { redhaven: 'red', bluehaven: 'blue' },
      armies: [],
      ...extra,
    }),
  );
}

function run(state: GameState, ticks: number, ruleset: Ruleset = rules): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, ruleset);
  return current;
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('relations', () => {
  it('starts every pair at war', () => {
    const state = game();
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(areHostile(state, 'red', 'blue')).toBe(true);
    expect(areHostile(state, 'red', 'red')).toBe(false);
  });

  it('can start with treaties in force', () => {
    const state = game({ relations: [{ a: 'blue', b: 'red', kind: 'alliance' }] });
    expect(relationBetween(state, 'red', 'blue')).toBe('alliance');
    expect(areAllied(state, 'blue', 'red')).toBe(true);
    expect(alliesOf(state, 'red')).toEqual(['blue']);
    expect(state.relations).toEqual([{ a: 'blue', b: 'red', kind: 'alliance' }]);
  });

  it('starts a truce with its full duration', () => {
    const state = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    expect(state.relations[0]?.until).toBe(rules.diplomacy.truceTicks);
  });

  it('rejects invalid treaties at creation', () => {
    expect(() => game({ relations: [{ a: 'red', b: 'red', kind: 'truce' }] })).toThrow();
    expect(() => game({ relations: [{ a: 'red', b: 'nobody', kind: 'truce' }] })).toThrow();
    expect(() =>
      game({
        relations: [
          { a: 'red', b: 'blue', kind: 'truce' },
          { a: 'blue', b: 'red', kind: 'alliance' },
        ],
      }),
    ).toThrow();
  });

  it('validates the diplomacy rules', () => {
    expect(() => game({}, { ...rules, diplomacy: { ...rules.diplomacy, truceTicks: 0 } })).toThrow();
    expect(() => game({}, { ...rules, diplomacy: { ...rules.diplomacy, warNoticeTicks: -1 } })).toThrow();
    expect(() => game({}, { ...rules, diplomacy: { ...rules.diplomacy, proposalTicks: 0 } })).toThrow();
  });
});

describe('proposals', () => {
  it('lets the other player accept a truce', () => {
    let state = ok(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    expect(state.proposals).toHaveLength(1);
    const proposal = state.proposals[0];
    expect(proposal?.from).toBe('red');
    expect(proposal?.expiresAt).toBe(state.tick + rules.diplomacy.proposalTicks);

    state = ok(orderRespond(state, rules, 'blue', proposal?.id ?? '', true)).state;
    expect(state.proposals).toHaveLength(0);
    expect(relationBetween(state, 'red', 'blue')).toBe('truce');
    expect(state.events.map((e) => e.type)).toEqual(['proposal_made', 'proposal_accepted', 'relation_changed']);
  });

  it('removes a rejected proposal and changes nothing', () => {
    let state = ok(orderPropose(game(), rules, 'red', 'blue', 'alliance')).state;
    state = ok(orderRespond(state, rules, 'blue', state.proposals[0]?.id ?? '', false)).state;
    expect(state.proposals).toHaveLength(0);
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(state.events.map((e) => e.type)).toEqual(['proposal_made', 'proposal_rejected']);
  });

  it('only lets the recipient answer', () => {
    const state = ok(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    const id = state.proposals[0]?.id ?? '';
    expect(orderRespond(state, rules, 'red', id, true)).toEqual({ ok: false, error: 'not_recipient' });
    expect(orderRespond(state, rules, 'blue', 'prop-999', true)).toEqual({ ok: false, error: 'proposal_not_found' });
  });

  it('refuses nonsense proposals', () => {
    const state = game({ players: three });
    expect(orderPropose(state, rules, 'red', 'red', 'truce')).toEqual({ ok: false, error: 'same_player' });
    expect(orderPropose(state, rules, 'red', 'nobody', 'truce')).toEqual({ ok: false, error: 'player_not_found' });

    const offered = ok(orderPropose(state, rules, 'red', 'blue', 'truce')).state;
    expect(orderPropose(offered, rules, 'red', 'blue', 'truce')).toEqual({ ok: false, error: 'already_proposed' });
    // The other side cannot offer the same thing: it can just accept.
    expect(orderPropose(offered, rules, 'blue', 'red', 'truce')).toEqual({ ok: false, error: 'already_proposed' });
    // A different treaty is a different offer.
    expect(orderPropose(offered, rules, 'red', 'blue', 'alliance').ok).toBe(true);

    const allied = game({ relations: [{ a: 'red', b: 'blue', kind: 'alliance' }] });
    expect(orderPropose(allied, rules, 'red', 'blue', 'truce')).toEqual({ ok: false, error: 'already_allied' });
  });

  it('reports its events in the next tick instead of losing them', () => {
    let state = ok(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    expect(state.events).toEqual([expect.objectContaining({ type: 'proposal_made', tick: state.tick + 1 })]);
    state = tick(state, rules);
    expect(state.events.map((e) => e.type)).toEqual(['proposal_made']);
    expect(state.events[0]?.tick).toBe(state.tick);
    // ...and only once.
    expect(tick(state, rules).events).toEqual([]);
  });

  it('does not change the input state', () => {
    const state = game();
    const before = structuredClone(state);
    orderPropose(state, rules, 'red', 'blue', 'truce');
    expect(state).toEqual(before);
  });

  it('expires when nobody answers', () => {
    let state = ok(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    state = run(state, rules.diplomacy.proposalTicks - 1);
    expect(state.proposals).toHaveLength(1);
    state = tick(state, rules);
    expect(state.proposals).toHaveLength(0);
    expect(state.events.some((e) => e.type === 'proposal_expired')).toBe(true);
  });

  it('never downgrades an alliance signed in the meantime', () => {
    let state = ok(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    const truceId = state.proposals[0]?.id ?? '';
    state = ok(orderPropose(state, rules, 'red', 'blue', 'alliance')).state;
    const allianceId = state.proposals[1]?.id ?? '';
    state = ok(orderRespond(state, rules, 'blue', allianceId, true)).state;
    expect(orderRespond(state, rules, 'blue', truceId, true)).toEqual({ ok: false, error: 'already_allied' });
  });

  it('can renew a truce before it runs out', () => {
    let state = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    state = run(state, 40);
    state = ok(orderPropose(state, rules, 'red', 'blue', 'truce')).state;
    state = ok(orderRespond(state, rules, 'blue', state.proposals[0]?.id ?? '', true)).state;
    expect(state.relations[0]?.until).toBe(40 + rules.diplomacy.truceTicks);
  });

  it('is refused when the game is over or a player is eliminated', () => {
    const over = { ...game(), outcome: { winner: 'red', winners: ['red'], reason: 'domination' as const } };
    expect(orderPropose(over, rules, 'red', 'blue', 'truce')).toEqual({ ok: false, error: 'game_over' });
    const gone = { ...game({ players: three }), eliminated: ['blue'] };
    expect(orderPropose(gone, rules, 'red', 'blue', 'truce')).toEqual({ ok: false, error: 'player_eliminated' });
  });
});

describe('declaring war', () => {
  it('needs a treaty to break', () => {
    expect(orderDeclareWar(game(), rules, 'red', 'blue')).toEqual({ ok: false, error: 'already_at_war' });
  });

  it('starts the war after the notice, not before', () => {
    let state = game({ relations: [{ a: 'red', b: 'blue', kind: 'alliance' }] });
    state = ok(orderDeclareWar(state, rules, 'red', 'blue')).state;
    const warAt = state.tick + rules.diplomacy.warNoticeTicks;
    expect(state.relations[0]?.warAt).toBe(warAt);
    expect(state.events.map((e) => e.type)).toEqual(['war_declared']);
    // Still allied during the notice.
    expect(relationBetween(state, 'red', 'blue')).toBe('alliance');
    expect(orderDeclareWar(state, rules, 'blue', 'red')).toEqual({ ok: false, error: 'war_pending' });
    expect(orderPropose(state, rules, 'blue', 'red', 'truce')).toEqual({ ok: false, error: 'war_pending' });

    state = run(state, rules.diplomacy.warNoticeTicks - 1);
    expect(relationBetween(state, 'red', 'blue')).toBe('alliance');
    state = tick(state, rules);
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(state.events.some((e) => e.type === 'relation_changed' && e.status === 'war')).toBe(true);
  });

  it('is immediate with a notice of 0', () => {
    const noNotice = { ...rules, diplomacy: { ...rules.diplomacy, warNoticeTicks: 0 } };
    let state = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] }, noNotice);
    state = ok(orderDeclareWar(state, noNotice, 'blue', 'red')).state;
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
  });

  it('drops pending offers between the two', () => {
    let state = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    state = ok(orderPropose(state, rules, 'blue', 'red', 'alliance')).state;
    state = ok(orderDeclareWar(state, rules, 'red', 'blue')).state;
    expect(state.proposals).toHaveLength(0);
  });

  it('turns a truce into war when it runs out', () => {
    let state = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    state = run(state, rules.diplomacy.truceTicks - 1);
    expect(relationBetween(state, 'red', 'blue')).toBe('truce');
    state = tick(state, rules);
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(state.events.some((e) => e.type === 'relation_changed' && e.reason === 'expired')).toBe(true);
  });

  it('never ends an alliance by itself', () => {
    const state = run(game({ relations: [{ a: 'red', b: 'blue', kind: 'alliance' }] }), 500);
    expect(relationBetween(state, 'red', 'blue')).toBe('alliance');
  });
});

describe('treaties and armies', () => {
  const meet = (kind: 'truce' | 'alliance' | null): GameState => {
    const state = game({
      owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' },
      armies: [
        { id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 10 } },
        { id: 'b1', owner: 'blue', location: 'midfield', units: { infantry: 10 } },
      ],
      relations: kind ? [{ a: 'red', b: 'blue', kind }] : [],
    });
    return ok(orderMove(state, 'blue', 'b1', 'westmark')).state;
  };

  it('does not fight or conquer between truce partners', () => {
    const state = run(meet('truce'), 10);
    expect(state.events.every((e) => e.type !== 'battle')).toBe(true);
    const army = state.armies.find((a) => a.id === 'b1');
    expect(army?.location).toBe('westmark');
    expect(state.armies.find((a) => a.id === 'r1')?.units.infantry).toBe(10);
    expect(state.provinces.find((p) => p.id === 'westmark')?.owner).toBe('red');
  });

  it('does not fight or conquer between allies', () => {
    const state = run(meet('alliance'), 10);
    expect(state.armies).toHaveLength(2);
    expect(state.provinces.find((p) => p.id === 'westmark')?.owner).toBe('red');
  });

  it('still fights at war', () => {
    const state = run(meet(null), 3);
    expect(state.events.some((e) => e.type === 'battle')).toBe(true);
  });

  it('lets an army walk through the land of a truce partner without stopping', () => {
    let state = game({
      owners: { redhaven: 'red', westmark: 'red' },
      armies: [
        { id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 10 } },
        { id: 'b1', owner: 'blue', location: 'redhaven', units: { infantry: 5 } },
      ],
      relations: [{ a: 'red', b: 'blue', kind: 'truce' }],
    });
    state = ok(orderMove(state, 'blue', 'b1', 'midfield')).state;
    state = run(state, 12);
    expect(state.armies.find((a) => a.id === 'b1')?.location).toBe('midfield');
  });

  it('lets a truce partner keep the province it stands in without taking it', () => {
    // Blue stands alone in red land, but under a truce it is not a conquest.
    const state = run(
      game({
        owners: { redhaven: 'red', westmark: 'red' },
        armies: [{ id: 'b1', owner: 'blue', location: 'westmark', units: { infantry: 5 } }],
        relations: [{ a: 'red', b: 'blue', kind: 'truce' }],
      }),
      3,
    );
    expect(state.provinces.find((p) => p.id === 'westmark')?.owner).toBe('red');
  });

  it('conquers as soon as the treaty ends', () => {
    let state = game({
      owners: { redhaven: 'red', westmark: 'red' },
      armies: [{ id: 'b1', owner: 'blue', location: 'westmark', units: { infantry: 5 } }],
      relations: [{ a: 'red', b: 'blue', kind: 'alliance' }],
    });
    state = ok(orderDeclareWar(state, rules, 'red', 'blue')).state;
    state = run(state, rules.diplomacy.warNoticeTicks);
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(state.provinces.find((p) => p.id === 'westmark')?.owner).toBe('blue');
  });

  it('lets an ally defend a province: the enemy fights both', () => {
    // Blue (ally of red) and green (enemy of red) in a red province. Red has no army there.
    const state = run(
      createGame({
        map: tinyMap,
        rules,
        players: three,
        owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue', eastmark: 'green' },
        armies: [
          { id: 'b1', owner: 'blue', location: 'westmark', units: { infantry: 10 } },
          { id: 'g1', owner: 'green', location: 'westmark', units: { infantry: 10 } },
        ],
        relations: [{ a: 'red', b: 'blue', kind: 'alliance' }],
      }),
      1,
    );
    // Blue and green are at war with each other: they fight, and neither takes the province alone.
    expect(state.events.some((e) => e.type === 'battle')).toBe(true);
    expect(state.provinces.find((p) => p.id === 'westmark')?.owner).toBe('red');
  });

  it('allows recruiting with a truce partner in the province but not with an enemy', () => {
    const base = {
      owners: { redhaven: 'red' },
      armies: [{ id: 'b1', owner: 'blue', location: 'redhaven', units: { infantry: 5 } }],
      stockpiles: { red: { grain: 50000, iron: 50000 } },
    };
    const truce = game({ ...base, relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    expect(orderRecruit(truce, rules, 'red', 'redhaven', 'infantry', 1).ok).toBe(true);
    const war = game(base);
    expect(orderRecruit(war, rules, 'red', 'redhaven', 'infantry', 1)).toEqual({ ok: false, error: 'enemy_present' });
  });
});

describe('resolveRound with hostility', () => {
  const sides = [{ infantry: 10 }, { infantry: 10 }, { infantry: 10 }];

  it('matches the old behaviour when everyone fights everyone', () => {
    expect(resolveRound(rules, sides)).toEqual(resolveRound(rules, sides, () => true));
  });

  it('leaves a side nobody fights untouched', () => {
    // Sides 0 and 1 are allies, side 2 fights both; 0 and 1 do not fight each other.
    const hostile = (i: number, j: number) => i === 2 || j === 2;
    const result = resolveRound(rules, sides, hostile);
    expect(result[0]).toBeLessThan(1);
    expect(result[0]).toBe(result[1]);
    const alone = resolveRound(rules, sides, (i, j) => (i === 0 || j === 0) && i !== j && i !== 1 && j !== 1);
    expect(alone[1]).toBe(1);
  });

  it('allies share the damage: two allied sides lose less than one alone', () => {
    const hostile = (i: number, j: number) => i === 2 || j === 2;
    const together = resolveRound(rules, [{ infantry: 10 }, { infantry: 10 }, { infantry: 10 }], hostile);
    const lone = resolveRound(rules, [{ infantry: 10 }, { infantry: 10 }], () => true);
    expect(together[0]).toBeGreaterThan(lone[0] ?? 0);
  });
});

describe('coalition victory', () => {
  it('lets allies win together when they own the domination share', () => {
    // 5 provinces: red 2 + blue 1 = 3 of 5 = 60%.
    const state = tick(
      createGame({
        map: tinyMap,
        rules,
        players: three,
        owners: { redhaven: 'red', westmark: 'red', midfield: 'blue', eastmark: 'green' },
        armies: [
          { id: 'g1', owner: 'green', location: 'eastmark', units: { infantry: 1 } },
          { id: 'b1', owner: 'blue', location: 'midfield', units: { infantry: 1 } },
        ],
        relations: [{ a: 'red', b: 'blue', kind: 'alliance' }],
      }),
      rules,
    );
    expect(state.outcome).toEqual({ winner: 'blue', winners: ['blue', 'red'].sort(), reason: 'coalition' });
  });

  it('does not let allies win just by being allied', () => {
    const state = tick(
      game({
        owners: { redhaven: 'red', bluehaven: 'blue' },
        armies: [{ id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: 1 } }],
        relations: [{ a: 'red', b: 'blue', kind: 'alliance' }],
      }),
      rules,
    );
    expect(state.outcome).toBeNull();
  });

  it('does not count a truce as a coalition', () => {
    const state = tick(
      createGame({
        map: tinyMap,
        rules,
        players: two,
        owners: { redhaven: 'red', westmark: 'red', midfield: 'blue' },
        armies: [{ id: 'b1', owner: 'blue', location: 'midfield', units: { infantry: 1 } }],
        relations: [{ a: 'red', b: 'blue', kind: 'truce' }],
      }),
      rules,
    );
    expect(state.outcome).toBeNull();
  });

  it('only counts groups whose members are all allied with each other', () => {
    // Red is allied with blue and green, but blue and green are at war: no 3-player coalition.
    const state = tick(
      createGame({
        map: tinyMap,
        rules,
        players: three,
        owners: { redhaven: 'red', westmark: 'blue', midfield: 'green' },
        armies: [
          { id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: 1 } },
          { id: 'b1', owner: 'blue', location: 'westmark', units: { infantry: 1 } },
          { id: 'g1', owner: 'green', location: 'midfield', units: { infantry: 1 } },
        ],
        relations: [
          { a: 'red', b: 'blue', kind: 'alliance' },
          { a: 'green', b: 'red', kind: 'alliance' },
        ],
      }),
      rules,
    );
    // 3 of 5 provinces belong to the three players together, but they are not a valid group.
    expect(state.outcome).toBeNull();
  });
});

describe('AI diplomacy', () => {
  const armies = (red: number, blue: number) => [
    { id: 'r1', owner: 'red', location: 'redhaven', units: { infantry: red } },
    { id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: blue } },
  ];

  it('accepts a truce from a player stronger than itself', () => {
    let state = game({ armies: armies(30, 10) });
    state = ok(orderPropose(state, rules, 'red', 'blue', 'truce')).state;
    state = runAi(state, rules, 'blue');
    expect(relationBetween(state, 'red', 'blue')).toBe('truce');
  });

  it('rejects a truce from a player weaker than itself', () => {
    let state = game({ armies: armies(10, 30) });
    state = ok(orderPropose(state, rules, 'red', 'blue', 'truce')).state;
    state = runAi(state, rules, 'blue');
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    expect(state.proposals).toHaveLength(0);
    expect(state.events.some((e) => e.type === 'proposal_rejected')).toBe(true);
  });

  it('accepts an alliance only against a common enemy', () => {
    const noEnemy = ok(orderPropose(game({ armies: armies(10, 10) }), rules, 'red', 'blue', 'alliance')).state;
    // Red and blue are the only players, so nobody else is at war with both.
    expect(relationBetween(runAi(noEnemy, rules, 'blue'), 'red', 'blue')).toBe('war');

    let withEnemy = createGame({
      map: tinyMap,
      rules,
      players: three,
      owners: { redhaven: 'red', bluehaven: 'blue', eastmark: 'green' },
      armies: [],
    });
    withEnemy = ok(orderPropose(withEnemy, rules, 'red', 'blue', 'alliance')).state;
    expect(relationBetween(runAi(withEnemy, rules, 'blue'), 'red', 'blue')).toBe('alliance');
  });

  it('asks for a truce when it is much weaker, on its diplomacy turn only', () => {
    const state = game({ armies: armies(40, 10) });
    expect(state.tick % 10).toBe(0);
    const asked = runAi(state, rules, 'blue');
    expect(asked.proposals).toEqual([expect.objectContaining({ from: 'blue', to: 'red', kind: 'truce' })]);
    // The same turn again does not pile up offers.
    expect(runAi(asked, rules, 'blue').proposals).toHaveLength(1);
    // Off-turn it stays quiet.
    const offTurn = runAi(run(state, 1), rules, 'blue');
    expect(offTurn.proposals).toHaveLength(0);
  });

  // Red owns most of the map: with the normal 60% rule the game would end at once.
  const noDomination: Ruleset = { ...rules, victory: { provinceShare: 1 } };
  const redLand = { redhaven: 'red', westmark: 'red', midfield: 'red', eastmark: 'red', bluehaven: 'blue' };
  const standoff = (kind: 'truce' | 'alliance'): GameState =>
    game(
      {
        owners: redLand,
        armies: [
          { id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 30 } },
          { id: 'b1', owner: 'blue', location: 'bluehaven', units: { infantry: 10 } },
        ],
        relations: [{ a: 'red', b: 'blue', kind }],
      },
      noDomination,
    );

  it('does not attack a player it has a truce or alliance with', () => {
    for (const kind of ['truce', 'alliance'] as const) {
      const state = runAi(standoff(kind), noDomination, 'red');
      expect(state.armies.find((a) => a.id === 'r1')?.order).toBeNull();
    }
  });

  it('attacks again once the truce is over', () => {
    let state = standoff('truce');
    state = run(state, noDomination.diplomacy.truceTicks, noDomination);
    expect(relationBetween(state, 'red', 'blue')).toBe('war');
    state = runAi(state, noDomination, 'red');
    expect(state.armies.find((a) => a.id === 'r1')?.order).not.toBeNull();
  });
});
