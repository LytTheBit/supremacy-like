import { describe, expect, it } from 'vitest';
import {
  activeSpies,
  baseRuleset,
  createGame,
  duelMap,
  isEventVisible,
  orderRecallSpy,
  orderSpy,
  orderSpyMission,
  spiedProvinces,
  tick,
  viewFor,
  visibleProvinces,
  type GameEvent,
  type GameState,
  type Ruleset,
} from '../src';

const rules = baseRuleset;
const esp = rules.espionage!;
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

/** Red and blue at war (the default), blue's capital has a barracks and a factory. Red can afford many spies. */
function game(extra: Partial<Parameters<typeof createGame>[0]> = {}, ruleset: Ruleset = rules): GameState {
  return createGame({
    map: duelMap,
    rules: ruleset,
    players,
    owners,
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    buildings: [
      { provinceId: 'bcap', type: 'barracks' },
      { provinceId: 'bcap', type: 'factory' },
    ],
    stockpiles: { red: { grain: 100000, wood: 100000 }, blue: { grain: 7000, iron: 9000 } },
    ...extra,
  });
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function run(state: GameState, ticks: number, ruleset: Ruleset = rules): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let current = state;
  for (let i = 0; i < ticks; i++) {
    current = tick(current, ruleset);
    events.push(...current.events);
  }
  return { state: current, events };
}

/** A spy of red in bcap, already in place. */
function spyInPlace(): { state: GameState; spyId: string } {
  const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
  const state = run(sent, esp.infiltrateTicks).state;
  const spy = state.spies[0];
  if (!spy) throw new Error('no spy');
  return { state, spyId: spy.id };
}

describe('orderSpy', () => {
  it('sends a spy, pays the cost and leaves the input untouched', () => {
    const before = game();
    const snapshot = structuredClone(before);
    const { state } = must(orderSpy(before, rules, 'red', 'bcap'));

    expect(before).toEqual(snapshot);
    expect(state.spies).toEqual([
      {
        id: expect.stringMatching(/^spy-/),
        owner: 'red',
        provinceId: 'bcap',
        infiltrationLeft: esp.infiltrateTicks,
        coverLeft: esp.coverTicks,
        mission: null,
      },
    ]);
    const stock = (s: GameState, r: string) => s.players.find((p) => p.id === 'red')?.stockpile[r] ?? 0;
    expect(stock(state, 'grain')).toBe(stock(before, 'grain') - (esp.cost.grain ?? 0));
    expect(stock(state, 'wood')).toBe(stock(before, 'wood') - (esp.cost.wood ?? 0));
  });

  it('allows spying on a truce partner and on a player at war, not on allies, neutrals or yourself', () => {
    const truce = game({ relations: [{ a: 'red', b: 'blue', kind: 'truce' }] });
    expect(orderSpy(truce, rules, 'red', 'bcap').ok).toBe(true);

    const allied = game({ relations: [{ a: 'red', b: 'blue', kind: 'alliance' }] });
    expect(orderSpy(allied, rules, 'red', 'bcap')).toEqual({ ok: false, error: 'not_spyable' });
    expect(orderSpy(game(), rules, 'red', 'rcap')).toEqual({ ok: false, error: 'not_spyable' });
    expect(orderSpy(game(), rules, 'red', 'mnorth')).toEqual({ ok: false, error: 'not_spyable' });
  });

  it('refuses invalid or unaffordable requests', () => {
    const state = game();
    expect(orderSpy(state, rules, 'red', 'nowhere')).toEqual({ ok: false, error: 'province_not_found' });
    expect(orderSpy(state, rules, 'nobody', 'bcap')).toEqual({ ok: false, error: 'player_not_found' });
    // Blue is nearly broke: not enough wood.
    expect(orderSpy(state, rules, 'blue', 'rcap')).toEqual({ ok: false, error: 'insufficient_resources' });
    expect(orderSpy(state, { ...rules, espionage: undefined }, 'red', 'bcap')).toEqual({
      ok: false,
      error: 'espionage_unavailable',
    });
    expect(orderSpy({ ...state, outcome: { winner: 'red', winners: ['red'], reason: 'domination' } }, rules, 'red', 'bcap')).toEqual({
      ok: false,
      error: 'game_over',
    });
    const dead = { ...state, eliminated: ['red'] };
    expect(orderSpy(dead, rules, 'red', 'bcap')).toEqual({ ok: false, error: 'player_eliminated' });
  });

  it('allows one spy per province and at most maxSpies in total', () => {
    let state = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    expect(orderSpy(state, rules, 'red', 'bcap')).toEqual({ ok: false, error: 'already_spied' });

    state = must(orderSpy(state, rules, 'red', 'biron')).state;
    state = must(orderSpy(state, rules, 'red', 'bwood')).state;
    expect(state.spies).toHaveLength(esp.maxSpies);
    expect(orderSpy(state, rules, 'red', 'bcoal')).toEqual({ ok: false, error: 'too_many_spies' });
    // The limit is per player: blue can still send one (when it can pay).
    const rich = game({ stockpiles: { red: { grain: 1e6, wood: 1e6 }, blue: { grain: 1e6, wood: 1e6 } } });
    const both = must(orderSpy(must(orderSpy(rich, rules, 'red', 'bcap')).state, rules, 'blue', 'rcap')).state;
    expect(both.spies.map((s) => s.owner)).toEqual(['red', 'blue']);
  });
});

describe('infiltration and vision', () => {
  it('gets the spy into place after infiltrateTicks, with an event only for its owner', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const { state, events } = run(sent, esp.infiltrateTicks);

    expect(state.spies[0]?.infiltrationLeft).toBe(0);
    const arrival = events.filter((e) => e.type === 'spy_in_place');
    expect(arrival).toHaveLength(1);
    const noVision = new Set<string>();
    for (const e of arrival) {
      expect(isEventVisible(e, noVision, 'red')).toBe(true);
      expect(isEventVisible(e, noVision, 'blue')).toBe(false);
    }
  });

  it('puts the province in sight only once the spy is in place', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    expect(visibleProvinces(sent, rules, 'red').has('bcap')).toBe(false);

    const placed = run(sent, esp.infiltrateTicks).state;
    expect(visibleProvinces(placed, rules, 'red').has('bcap')).toBe(true);
    expect(visibleProvinces(placed, rules, 'blue').has('bcap')).toBe(true); // its own province
    expect(spiedProvinces(placed, new Set(['red']))).toEqual(new Set(['bcap']));
    expect(spiedProvinces(placed, new Set(['blue']))).toEqual(new Set());
    expect(activeSpies(sent, new Set(['red']))).toEqual([]);
  });

  it('shows buildings, armies, the jobs there and the stockpile of the spied province', () => {
    const { state } = spyInPlace();
    // Blue is training something at its capital and building in another province.
    const busy = structuredClone(state);
    busy.recruitQueue.push({ id: 'j1', owner: 'blue', provinceId: 'bcap', unitType: 'infantry', count: 3, ticksLeft: 2 });
    busy.recruitQueue.push({ id: 'j2', owner: 'blue', provinceId: 'bwood', unitType: 'infantry', count: 1, ticksLeft: 2 });
    busy.constructionQueue.push({ id: 'c1', owner: 'blue', provinceId: 'bcap', buildingType: 'workshop', ticksLeft: 3 });

    const view = viewFor(busy, rules, 'red').state;
    expect(view.provinces.find((p) => p.id === 'bcap')?.buildings).toEqual(['barracks', 'factory']);
    expect(view.armies.some((a) => a.owner === 'blue' && a.location === 'bcap')).toBe(true);
    expect(view.recruitQueue.map((j) => j.id)).toEqual(['j1']); // only the spied province
    expect(view.constructionQueue.map((j) => j.id)).toEqual(['c1']);
    // Blue's real stockpile (it has been producing meanwhile) is what the spy reports.
    expect(view.players.find((p) => p.id === 'blue')?.stockpile).toEqual(busy.players.find((p) => p.id === 'blue')?.stockpile);
    expect(Object.keys(view.players.find((p) => p.id === 'blue')?.stockpile ?? {}).length).toBeGreaterThan(0);
  });

  it('shows none of that without a spy', () => {
    const view = viewFor(game(), rules, 'red').state;
    expect(view.provinces.find((p) => p.id === 'bcap')?.buildings).toEqual([]);
    expect(view.players.find((p) => p.id === 'blue')?.stockpile).toEqual({});
  });

  it('never shows the spies of other players, with or without fog', () => {
    const { state } = spyInPlace();
    for (const ruleset of [rules, noFog]) {
      expect(viewFor(state, ruleset, 'red').state.spies).toHaveLength(1);
      expect(viewFor(state, ruleset, 'blue').state.spies).toEqual([]);
      expect(viewFor(state, ruleset, 'green').state.spies).toEqual([]);
    }
  });

  it('shares what the spy sees with allies, but not the spy itself', () => {
    const { state } = spyInPlace();
    const allied = structuredClone(state);
    allied.relations.push({ a: 'green', b: 'red', kind: 'alliance' });
    const view = viewFor(allied, rules, 'green');
    expect(view.visible).toContain('bcap');
    expect(view.state.spies).toHaveLength(1); // team spies are shown to the team
  });
});

describe('sabotage', () => {
  it('destroys the building after the mission time and sends the spy home', () => {
    const { state, spyId } = spyInPlace();
    const started = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'factory' })).state;
    expect(started.spies[0]?.mission).toEqual({ kind: 'sabotage', buildingType: 'factory', ticksLeft: esp.sabotage.ticks });

    const early = run(started, esp.sabotage.ticks - 1);
    expect(early.state.provinces.find((p) => p.id === 'bcap')?.buildings).toContain('factory');

    const done = run(started, esp.sabotage.ticks);
    expect(done.state.provinces.find((p) => p.id === 'bcap')?.buildings).toEqual(['barracks']);
    expect(done.state.spies).toEqual([]);
    expect(done.events.find((e) => e.type === 'building_sabotaged')).toMatchObject({
      provinceId: 'bcap',
      buildingType: 'factory',
      by: 'red',
      target: 'blue',
    });
    expect(done.events.find((e) => e.type === 'spy_removed')).toMatchObject({ reason: 'mission_done', owner: 'red' });
  });

  it('is told to both sides, but the victim does not learn who did it', () => {
    const { state, spyId } = spyInPlace();
    const started = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'barracks' })).state;
    const { state: after, events } = run(started, esp.sabotage.ticks);
    const sabotage = events.find((e) => e.type === 'building_sabotaged');
    if (!sabotage) throw new Error('no sabotage event');

    const none = new Set<string>();
    expect(isEventVisible(sabotage, none, 'red')).toBe(true);
    expect(isEventVisible(sabotage, none, 'blue')).toBe(true);
    expect(isEventVisible(sabotage, none, 'green')).toBe(false);

    const blueEvents = viewFor(after, rules, 'blue').state.events;
    expect(blueEvents.find((e) => e.type === 'building_sabotaged')).toMatchObject({ by: null });
    // The real state still knows.
    expect(after.events.find((e) => e.type === 'building_sabotaged')).toMatchObject({ by: 'red' });
  });

  it('fails quietly when the building is already gone, and the spy goes on watching', () => {
    const { state, spyId } = spyInPlace();
    const started = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'factory' })).state;
    const gone = structuredClone(started);
    const bcap = gone.provinces.find((p) => p.id === 'bcap');
    if (bcap) bcap.buildings = ['barracks'];

    const { state: after, events } = run(gone, esp.sabotage.ticks);
    expect(events.some((e) => e.type === 'spy_mission_failed')).toBe(true);
    expect(after.spies).toHaveLength(1);
    expect(after.spies[0]?.mission).toBeNull();
  });

  it('is cut short when the cover is blown first', () => {
    const { state, spyId } = spyInPlace();
    const low = structuredClone(state);
    const spy = low.spies[0];
    if (spy) spy.coverLeft = esp.sabotage.ticks - 1; // not enough time
    const started = must(orderSpyMission(low, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'factory' })).state;

    const { state: after, events } = run(started, esp.sabotage.ticks);
    expect(after.provinces.find((p) => p.id === 'bcap')?.buildings).toContain('factory');
    expect(after.spies).toEqual([]);
    expect(events.find((e) => e.type === 'spy_removed')).toMatchObject({ reason: 'cover_blown' });
  });
});

describe('disinformation', () => {
  it('lowers the morale of the province and sends the spy home', () => {
    const { state, spyId } = spyInPlace();
    const started = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'disinformation' })).state;
    const { state: after, events } = run(started, esp.disinformation.ticks);

    // Blue's province regains 2 morale each tick before the blow lands (it is at 100 already).
    expect(after.provinces.find((p) => p.id === 'bcap')?.morale).toBe(100 - esp.disinformation.moraleDamage);
    expect(events.find((e) => e.type === 'morale_sabotaged')).toMatchObject({
      provinceId: 'bcap',
      damage: esp.disinformation.moraleDamage,
      by: 'red',
      target: 'blue',
    });
    expect(after.spies).toEqual([]);
  });

  it('never takes the morale below zero', () => {
    const { state, spyId } = spyInPlace();
    const weak = structuredClone(state);
    const bcap = weak.provinces.find((p) => p.id === 'bcap');
    if (bcap) bcap.morale = 10;
    const started = must(orderSpyMission(weak, rules, 'red', spyId, { kind: 'disinformation' })).state;
    const { state: after, events } = run(started, esp.disinformation.ticks);
    // The province recovers 2 morale per tick meanwhile, then the blow takes whatever is left (less than the full damage).
    const hit = events.find((e) => e.type === 'morale_sabotaged');
    expect(hit && hit.type === 'morale_sabotaged' ? hit.damage : -1).toBeLessThan(esp.disinformation.moraleDamage);
    expect(after.provinces.find((p) => p.id === 'bcap')?.morale).toBe(0);
  });
});

describe('orderSpyMission errors', () => {
  it('needs a spy in place, owned by the player, with no mission yet and a real building', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const travelling = sent.spies[0]?.id ?? '';
    expect(orderSpyMission(sent, rules, 'red', travelling, { kind: 'disinformation' })).toEqual({
      ok: false,
      error: 'spy_not_ready',
    });

    const { state, spyId } = spyInPlace();
    expect(orderSpyMission(state, rules, 'red', 'spy-999', { kind: 'disinformation' })).toEqual({ ok: false, error: 'spy_not_found' });
    expect(orderSpyMission(state, rules, 'blue', spyId, { kind: 'disinformation' })).toEqual({ ok: false, error: 'not_owner' });
    expect(orderSpyMission(state, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'port' })).toEqual({
      ok: false,
      error: 'no_such_building',
    });
    const busy = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'disinformation' })).state;
    expect(orderSpyMission(busy, rules, 'red', spyId, { kind: 'disinformation' })).toEqual({
      ok: false,
      error: 'mission_in_progress',
    });
  });
});

describe('cover and recall', () => {
  it('catches a spy that only watches when the cover runs out, and tells both sides', () => {
    const { state } = spyInPlace();
    const { state: after, events } = run(state, esp.coverTicks);

    expect(after.spies).toEqual([]);
    const caught = events.find((e) => e.type === 'spy_removed');
    expect(caught).toMatchObject({ reason: 'cover_blown', owner: 'red', target: 'blue', provinceId: 'bcap' });
    if (!caught) return;
    const none = new Set<string>();
    expect(isEventVisible(caught, none, 'red')).toBe(true);
    expect(isEventVisible(caught, none, 'blue')).toBe(true);
    expect(isEventVisible(caught, none, 'green')).toBe(false);
  });

  it('keeps the spy for exactly coverTicks ticks once in place', () => {
    const { state } = spyInPlace();
    expect(run(state, esp.coverTicks - 1).state.spies).toHaveLength(1);
    expect(run(state, esp.coverTicks).state.spies).toHaveLength(0);
  });

  it('lets the owner recall a spy at any time (no refund), and only the owner', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const id = sent.spies[0]?.id ?? '';
    expect(orderRecallSpy(sent, 'blue', id)).toEqual({ ok: false, error: 'not_owner' });
    expect(orderRecallSpy(sent, 'red', 'spy-999')).toEqual({ ok: false, error: 'spy_not_found' });

    const { state } = must(orderRecallSpy(sent, 'red', id));
    expect(state.spies).toEqual([]);
    expect(state.events.find((e) => e.type === 'spy_removed')).toMatchObject({ reason: 'recalled' });
    expect(state.players.find((p) => p.id === 'red')?.stockpile.grain).toBe(100000 - (esp.cost.grain ?? 0));
  });
});

describe('when the situation changes', () => {
  it('drops the spy when its province is conquered by its own owner', () => {
    const state = game({
      armies: [
        { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
        { id: 'r2', owner: 'red', location: 'bfront', units: { infantry: 5 } },
      ],
    });
    const sent = must(orderSpy(state, rules, 'red', 'bfront')).state;
    const { state: after, events } = run(sent, 1);
    expect(after.provinces.find((p) => p.id === 'bfront')?.owner).toBe('red');
    expect(after.spies).toEqual([]);
    expect(events.find((e) => e.type === 'spy_removed')).toMatchObject({ reason: 'target_changed' });
  });

  it('drops the spy when the owner of the province becomes an ally', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const allied = structuredClone(sent);
    allied.relations.push({ a: 'blue', b: 'red', kind: 'alliance' });
    const { state, events } = run(allied, 1);
    expect(state.spies).toEqual([]);
    expect(events.find((e) => e.type === 'spy_removed')).toMatchObject({ reason: 'target_changed' });
  });

  it('makes the spies of an eliminated player vanish without a trace', () => {
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const out = structuredClone(sent);
    out.eliminated.push('red');
    const { state, events } = run(out, 1);
    expect(state.spies).toEqual([]);
    expect(events.some((e) => e.type === 'spy_removed')).toBe(false);
  });

  it('does not stop the game from being deterministic', () => {
    const { state, spyId } = spyInPlace();
    const started = must(orderSpyMission(state, rules, 'red', spyId, { kind: 'sabotage', buildingType: 'barracks' })).state;
    expect(run(started, 6).state).toEqual(run(started, 6).state);
  });

  it('does not keep a player in the game by itself', () => {
    // A spy is not an army: a player with only spies left is eliminated like any other.
    const sent = must(orderSpy(game(), rules, 'red', 'bcap')).state;
    const lost = structuredClone(sent);
    for (const p of lost.provinces) if (p.owner === 'red') p.owner = 'blue';
    lost.armies = lost.armies.filter((a) => a.owner !== 'red');
    const { state } = run(lost, 1);
    expect(state.eliminated).toContain('red');
  });
});
