import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  defaultAiOptions,
  duelMap,
  orderSpyMission,
  runAi,
  runMatch,
  tick,
  type GameEvent,
  type GameState,
  type Ruleset,
} from '../src';

const rules = baseRuleset;
const esp = rules.espionage!;

function game(extra: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({
    map: duelMap,
    rules,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
    ],
    owners: {
      rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
      bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
    },
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    stockpiles: { red: { grain: 50000, wood: 50000, iron: 50000, coal: 50000 } },
    ...extra,
  });
}

/** Only the spy phase matters here: everything else is switched off by having nothing to spend on. */
const spiesOnly = { airForce: false, navy: false };

describe('AI spies', () => {
  it('sends a spy to the closest enemy province and pays for it', () => {
    const state = game();
    const next = runAi(state, rules, 'red', spiesOnly);
    expect(next.spies).toHaveLength(1);
    // bcoal and bfront are equally far from red's land: the lower id wins the tie.
    expect(next.spies[0]).toMatchObject({ owner: 'red', provinceId: 'bcoal' });
    // The AI also recruits and builds in the same turn: compare with the same turn without spies.
    const without = runAi(state, rules, 'red', { ...spiesOnly, spies: false });
    const grain = (s: GameState) => s.players.find((p) => p.id === 'red')?.stockpile.grain ?? 0;
    expect(grain(next)).toBe(grain(without) - (esp.cost.grain ?? 0));
  });

  it('does nothing when spies are off, impossible or too expensive for now', () => {
    expect(runAi(game(), rules, 'red', { ...spiesOnly, spies: false }).spies).toEqual([]);
    const noEspionage: Ruleset = { ...rules, espionage: undefined };
    expect(runAi(game(), noEspionage, 'red', spiesOnly).spies).toEqual([]);
    // Not enough to spare above the reserve.
    const poor = game({ stockpiles: { red: { grain: 9000, wood: 9000, iron: 50000 } } });
    expect(runAi(poor, rules, 'red', spiesOnly).spies).toEqual([]);
    // Only every spyInterval ticks.
    const later = { ...game(), tick: 3 };
    expect(runAi(later, rules, 'red', spiesOnly).spies).toEqual([]);
  });

  it('never has more spies than its limit, and watches each province once', () => {
    let state = game();
    for (let i = 0; i < 40; i++) {
      state = runAi(state, rules, 'red', { ...spiesOnly, spyInterval: 1, maxSpies: 2 });
      expect(state.spies.length).toBeLessThanOrEqual(2);
      const where = state.spies.map((s) => s.provinceId);
      expect(new Set(where).size).toBe(where.length);
      state = tick(state, rules);
    }
  });

  it('does not spy on players it is not at war with', () => {
    const truce = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    expect(runAi(truce, rules, 'red', spiesOnly).spies).toEqual([]);
  });

  it('sabotages the most expensive building of the province its spy is in', () => {
    const state = game({
      buildings: [
        { provinceId: 'bcoal', type: 'barracks' },
        { provinceId: 'bcoal', type: 'factory' },
        { provinceId: 'bcoal', type: 'workshop' },
      ],
    });
    let current = runAi(state, rules, 'red', spiesOnly);
    for (let i = 0; i < esp.infiltrateTicks; i++) current = tick(current, rules);
    expect(current.spies[0]?.infiltrationLeft).toBe(0);

    current = runAi(current, rules, 'red', spiesOnly);
    expect(current.spies[0]?.mission).toEqual({ kind: 'sabotage', buildingType: 'factory', ticksLeft: esp.sabotage.ticks });
  });

  it('spreads disinformation when there is nothing to sabotage, but not in a province with low morale', () => {
    const base = runAi(game(), rules, 'red', spiesOnly);
    let placed = base;
    for (let i = 0; i < esp.infiltrateTicks; i++) placed = tick(placed, rules);

    const harmed = runAi(placed, rules, 'red', spiesOnly);
    expect(harmed.spies[0]?.mission?.kind).toBe('disinformation');

    const shaky = structuredClone(placed);
    const watched = shaky.provinces.find((p) => p.id === shaky.spies[0]?.provinceId);
    if (watched) watched.morale = defaultAiOptions.minMoraleToHarm - 1;
    expect(runAi(shaky, rules, 'red', spiesOnly).spies[0]?.mission).toBeNull();
  });

  it('only watches (no mission) a province of a truce partner', () => {
    const base = runAi(game(), rules, 'red', spiesOnly);
    let placed = base;
    for (let i = 0; i < esp.infiltrateTicks; i++) placed = tick(placed, rules);
    const peace = structuredClone(placed);
    peace.relations.push({ a: 'blue', b: 'red', kind: 'truce', until: 999 });
    expect(runAi(peace, rules, 'red', spiesOnly).spies[0]?.mission).toBeNull();
  });

  it('does not start a mission its cover cannot finish', () => {
    const base = runAi(game(), rules, 'red', spiesOnly);
    let placed = base;
    for (let i = 0; i < esp.infiltrateTicks; i++) placed = tick(placed, rules);
    const burning = structuredClone(placed);
    const spy = burning.spies[0];
    if (spy) spy.coverLeft = Math.min(esp.sabotage.ticks, esp.disinformation.ticks) - 1;
    expect(runAi(burning, rules, 'red', spiesOnly).spies[0]?.mission).toBeNull();
  });

  it('uses only the normal orders: an AI spy order is the same as a human one', () => {
    const state = runAi(game(), rules, 'red', spiesOnly);
    const spy = state.spies[0];
    expect(spy).toBeDefined();
    // The AI cannot give a mission a human could not give.
    expect(orderSpyMission(state, rules, 'red', spy?.id ?? '', { kind: 'disinformation' })).toEqual({
      ok: false,
      error: 'spy_not_ready',
    });
  });

  it('is used in a whole AI vs AI match, and the match still ends', () => {
    const events: GameEvent[] = [];
    const final = runMatch(game({ stockpiles: { red: { grain: 15000, wood: 15000, iron: 15000, coal: 15000 }, blue: { grain: 15000, wood: 15000, iron: 15000, coal: 15000 } } }), rules, {
      aiPlayers: ['red', 'blue'],
      maxTicks: 300,
      onTick: (s) => events.push(...s.events),
    });
    expect(events.some((e) => e.type === 'spy_in_place')).toBe(true);
    expect(final.tick).toBeGreaterThan(0);
  });
});
