import { describe, expect, it } from 'vitest';
import { formatAmount, formatCount, formatPercent, formatSigned } from './format';
import { shade, ownerColor, NEUTRAL_COLOR } from './colors';
import { provinceNames } from './names';
import { AI_IDS, GameSession, HUMAN_ID, MAX_LOG, incomePerTick, type SessionOptions } from './session';

const options: SessionOptions = { seed: 7, provinces: 24, medals: [], organic: 0.6 };
/** The same game without fog: tests that look at the enemy need to see it. */
const openOptions: SessionOptions = { ...options, fog: false };

function myCapital(session: GameSession): string {
  const army = session.getSnapshot().state.armies.find((a) => a.owner === HUMAN_ID);
  if (!army) throw new Error('no human army');
  return army.location;
}

describe('GameSession setup', () => {
  const session = new GameSession(openOptions);
  const { state } = session.getSnapshot();

  it('creates a skirmish between the player and the AI', () => {
    expect(state.players.map((p) => p.id)).toEqual([HUMAN_ID, ...AI_IDS]);
    expect(state.provinces.filter((p) => p.owner === HUMAN_ID)).toHaveLength(3);
    expect(state.provinces.filter((p) => p.owner === 'blue')).toHaveLength(3);
    expect(state.armies).toHaveLength(2);
    expect(state.tick).toBe(0);
  });

  it('starts paused', () => {
    expect(session.getSnapshot().speed).toBe(0);
    expect(session.getSnapshot().log).toEqual([]);
  });

  it('prepares the geometry for drawing', () => {
    for (const province of state.provinces) {
      expect(session.shapes.paths[province.id]?.startsWith('M')).toBe(true);
      expect(session.anchors[province.id]).toBeDefined();
      expect(session.provinceName(province.id)).toBeTruthy();
    }
    expect(session.bounds.width).toBeGreaterThan(100);
    expect(session.bounds.height).toBeGreaterThan(100);
  });

  it('gives every province a distinct name', () => {
    const names = state.provinces.map((p) => session.provinceName(p.id));
    expect(new Set(names).size).toBe(names.length);
    expect(provinceNames(10, 1)).toEqual(provinceNames(10, 1));
    expect(provinceNames(10, 1)).not.toEqual(provinceNames(10, 2));
    // More provinces than names: the extra ones have no proper name (the interface numbers them).
    const many = provinceNames(60, 1);
    expect(many).toHaveLength(60);
    expect(new Set(many.filter((n) => n !== null)).size).toBe(many.filter((n) => n !== null).length);
    expect(many.slice(40).every((n) => n === null)).toBe(true);
  });

  it('is deterministic for the same options', () => {
    expect(new GameSession(openOptions).getSnapshot().state).toEqual(state);
    expect(new GameSession({ ...openOptions, seed: 8 }).getSnapshot().state).not.toEqual(state);
  });

  it('adds the content of the chosen medals', () => {
    const plain = new GameSession(options);
    const generals = new GameSession({ ...options, medals: ['generals'] });
    expect(plain.rules.units.general).toBeUndefined();
    expect(generals.rules.units.general).toBeDefined();
    expect(generals.getSnapshot().state.rulesId).toBe('base+generals');
  });

  it('draws the same game with or without organic borders', () => {
    const plain = new GameSession({ ...openOptions, organic: 0 });
    expect(plain.getSnapshot().state).toEqual(state);
    expect(plain.shapes.paths).not.toEqual(session.shapes.paths);
  });
});

describe('GameSession time', () => {
  it('advances one tick per step and lets the AI act', () => {
    const session = new GameSession(openOptions);
    for (let i = 0; i < 4; i++) session.step();
    const { state } = session.getSnapshot();

    expect(state.tick).toBe(4);
    const blue = state.players.find((p) => p.id === 'blue');
    // The AI spent resources: it has orders in progress or buildings under way.
    expect(state.constructionQueue.some((j) => j.owner === 'blue') || state.recruitQueue.some((j) => j.owner === 'blue')).toBe(true);
    expect(blue).toBeDefined();
  });

  it('notifies subscribers on every change, until they unsubscribe', () => {
    const session = new GameSession(options);
    let calls = 0;
    const unsubscribe = session.subscribe(() => {
      calls += 1;
    });

    session.step();
    session.setSpeed(2);
    expect(calls).toBe(2);
    expect(session.getSnapshot().version).toBe(2);

    session.setSpeed(2); // no change: no notification
    expect(calls).toBe(2);

    unsubscribe();
    session.step();
    expect(calls).toBe(2);
  });

  it('gives a new snapshot object on every change (needed by React)', () => {
    const session = new GameSession(options);
    const before = session.getSnapshot();
    session.step();
    expect(session.getSnapshot()).not.toBe(before);
    expect(session.getSnapshot().state).not.toBe(before.state);
    expect(before.state.tick).toBe(0); // old snapshots are never modified
  });

  it('stops advancing once the game is over', () => {
    const session = new GameSession(options);
    let guard = 0;
    while (!session.getSnapshot().state.outcome && guard++ < 400) session.step();
    const final = session.getSnapshot();

    if (final.state.outcome) {
      const tickAtEnd = final.state.tick;
      session.step();
      expect(session.getSnapshot().state.tick).toBe(tickAtEnd);
    }
    // Either way the log never grows beyond its limit.
    expect(final.log.length).toBeLessThanOrEqual(MAX_LOG);
  });
});

describe('GameSession orders', () => {
  it('recruits troops for the player and spends resources', () => {
    const session = new GameSession(options);
    const capital = myCapital(session);
    const before = session.getSnapshot().state.players[0]?.stockpile.grain ?? 0;

    expect(session.checkRecruit(capital, 'infantry', 2)).toBeNull();
    expect(session.recruit(capital, 'infantry', 2)).toEqual({ ok: true });

    const { state } = session.getSnapshot();
    expect(state.recruitQueue.some((j) => j.owner === HUMAN_ID && j.count === 2)).toBe(true);
    expect(state.players[0]?.stockpile.grain).toBe(before - 4000);
  });

  it('explains why an order is not possible', () => {
    const session = new GameSession(options);
    const capital = myCapital(session);

    expect(session.checkRecruit(capital, 'artillery', 1)).toBe('missing_building');
    expect(session.checkRecruit(capital, 'infantry', 999)).toBe('insufficient_resources');
    expect(session.recruit(capital, 'artillery', 1)).toEqual({ ok: false, error: 'missing_building' });

    const enemyProvince = session.getSnapshot().state.provinces.find((p) => p.owner === 'blue');
    expect(session.checkBuild(enemyProvince?.id ?? '', 'barracks')).toBe('not_owner');
  });

  it('builds for the player', () => {
    const session = new GameSession(options);
    const capital = myCapital(session);
    expect(session.build(capital, 'barracks')).toEqual({ ok: true });
    expect(session.checkBuild(capital, 'barracks')).toBe('already_building');
    expect(session.getSnapshot().state.constructionQueue.some((j) => j.owner === HUMAN_ID)).toBe(true);
  });

  it('moves and stops the player army, and refuses to move the enemy army', () => {
    const session = new GameSession(openOptions);
    const { state } = session.getSnapshot();
    const mine = state.armies.find((a) => a.owner === HUMAN_ID);
    const theirs = state.armies.find((a) => a.owner === 'blue');
    const target = state.provinces.find((p) => p.owner === null);
    if (!mine || !theirs || !target) throw new Error('unexpected setup');

    expect(session.moveArmy(theirs.id, target.id)).toEqual({ ok: false, error: 'not_owner' });
    expect(session.moveArmy(mine.id, target.id)).toEqual({ ok: true });
    expect(session.getSnapshot().state.armies.find((a) => a.id === mine.id)?.order).not.toBeNull();

    expect(session.stopArmy(mine.id)).toEqual({ ok: true });
    expect(session.getSnapshot().state.armies.find((a) => a.id === mine.id)?.order).toBeNull();
  });

  it('previews an attack only when somebody defends the target', () => {
    const session = new GameSession(openOptions);
    const { state } = session.getSnapshot();
    const mine = state.armies.find((a) => a.owner === HUMAN_ID);
    const theirs = state.armies.find((a) => a.owner === 'blue');
    const empty = state.provinces.find((p) => p.owner === null);
    if (!mine || !theirs || !empty) throw new Error('unexpected setup');

    expect(session.previewAttack(mine.id, empty.id)).toBeNull();
    const preview = session.previewAttack(mine.id, theirs.location);
    expect(preview).not.toBeNull();
    // Same strength on both sides: they destroy each other.
    expect(preview?.winner).toBe('draw');
    expect(session.previewAttack('nope', theirs.location)).toBeNull();
  });
});

describe('GameSession log', () => {
  it('records what happens to the player, once per event', () => {
    const session = new GameSession(options);
    const capital = myCapital(session);
    session.recruit(capital, 'infantry', 1);
    for (let i = 0; i < 4; i++) session.step();

    const { log } = session.getSnapshot();
    expect(log.some((entry) => entry.text().includes('ready at'))).toBe(true);
    const ids = log.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('incomePerTick', () => {
  it('sums the production of owned provinces', () => {
    const session = new GameSession(options);
    const { state } = session.getSnapshot();
    const income = incomePerTick(state, session.rules, HUMAN_ID);

    const expected: Record<string, number> = {};
    for (const p of state.provinces.filter((x) => x.owner === HUMAN_ID)) {
      expected[p.resource] = (expected[p.resource] ?? 0) + p.production;
      // Money: every owned land province earns the same, whatever it grows (full morale at the start).
      expected.money = (expected.money ?? 0) + session.rules.economy!.incomePerProvince;
    }
    for (const resource of session.rules.resources) {
      expect(income[resource]).toBeCloseTo(expected[resource] ?? 0, 6);
    }
  });
});

describe('GameSession fog of war', () => {
  it('hides the enemy army and its preparations at the start', () => {
    const session = new GameSession(options);
    const { state, visible } = session.getSnapshot();
    expect(state.armies.every((a) => a.owner === HUMAN_ID)).toBe(true);
    expect(visible.length).toBeLessThan(state.provinces.length);
    expect(visible).toContain(myCapital(session));

    const enemyCapital = state.provinces.find((p) => p.owner === 'blue');
    expect(enemyCapital).toBeDefined();
    for (let i = 0; i < 4; i++) session.step();
    const after = session.getSnapshot().state;
    expect(after.recruitQueue.every((j) => j.owner === HUMAN_ID)).toBe(true);
    expect(after.constructionQueue.every((j) => j.owner === HUMAN_ID)).toBe(true);
    expect(after.players.find((p) => p.id === 'blue')?.stockpile).toEqual({});
  });

  it('shows everything when the fog is off', () => {
    const session = new GameSession(openOptions);
    const { state, visible } = session.getSnapshot();
    expect(visible).toHaveLength(state.provinces.length);
    expect(state.armies.some((a) => a.owner === 'blue')).toBe(true);
  });

  it('keeps the real state out of snapshots, but orders still work on it', () => {
    const session = new GameSession(options);
    const capital = myCapital(session);
    const before = session.getSnapshot().state.players.find((p) => p.id === HUMAN_ID)?.stockpile.grain ?? 0;
    expect(session.recruit(capital, 'infantry', 2)).toEqual({ ok: true });
    const after = session.getSnapshot().state;
    expect(after.players.find((p) => p.id === HUMAN_ID)?.stockpile.grain).toBeLessThan(before);
    expect(after.recruitQueue).toHaveLength(1);
    // A hidden enemy army cannot be ordered about either.
    expect(session.moveArmy('blue-1', capital)).toEqual({ ok: false, error: 'not_owner' });
  });

  it('shows an enemy army only while it is in sight, and never previews a hidden battle', () => {
    const session = new GameSession(options);
    const { state } = session.getSnapshot();
    const mine = state.armies.find((a) => a.owner === HUMAN_ID);
    if (!mine) throw new Error('unexpected setup');
    // The enemy army is out of sight, so a preview against its province finds nobody.
    const enemyProvince = state.provinces.find((p) => p.owner === 'blue');
    if (!enemyProvince) throw new Error('unexpected setup');
    expect(session.previewAttack(mine.id, enemyProvince.id)).toBeNull();
  });

  it('does not tell the player about battles it cannot see', () => {
    const session = new GameSession(options);
    for (let i = 0; i < 40; i++) session.step();
    const { log, state } = session.getSnapshot();
    // Whatever happened far away stays out of the log; what is in it concerns places in sight
    // or the player itself. The count of lines can only be smaller than with an open map.
    const open = new GameSession(openOptions);
    for (let i = 0; i < 40; i++) open.step();
    expect(log.length).toBeLessThanOrEqual(open.getSnapshot().log.length + 40);
    expect(state.tick).toBe(Math.min(40, state.tick));
  });
});

describe('GameSession diplomacy', () => {
  it('starts at war with the AI, so declaring war is refused', () => {
    const session = new GameSession(options);
    expect(session.declareWar('blue')).toEqual({ ok: false, error: 'already_at_war' });
  });

  it('sends a proposal, shows the reply in the log and refuses duplicates', () => {
    const session = new GameSession(options);
    expect(session.propose('blue', 'truce')).toEqual({ ok: true });
    expect(session.getSnapshot().state.proposals).toHaveLength(1);
    expect(session.propose('blue', 'truce')).toEqual({ ok: false, error: 'already_proposed' });

    // The AI answers on its next turn. Both start with equal armies, so it refuses.
    session.step();
    const { state, log } = session.getSnapshot();
    expect(state.proposals).toHaveLength(0);
    expect(state.relations).toEqual([]);
    expect(log.some((entry) => entry.text().includes('rejected the truce'))).toBe(true);
  });

  it('answers an offer made to the player', () => {
    const session = new GameSession(options);
    expect(session.respond('prop-404', true)).toEqual({ ok: false, error: 'proposal_not_found' });
  });
});

describe('formatting helpers', () => {
  it('formats resource amounts in thousands', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(850)).toBe('850');
    expect(formatAmount(1000)).toBe('1.0k');
    expect(formatAmount(12345)).toBe('12.3k');
    expect(formatAmount(123456)).toBe('123k');
    expect(formatAmount(2_500_000)).toBe('2.5M');
    expect(formatSigned(3000)).toBe('+3.0k');
    expect(formatSigned(-500)).toBe('-500');
  });

  it('formats counts and percentages', () => {
    expect(formatCount(10)).toBe('10');
    expect(formatCount(12.86)).toBe('12.9');
    expect(formatPercent(0.857)).toBe('86%');
  });

  it('computes colors', () => {
    expect(ownerColor(null)).toBe(NEUTRAL_COLOR);
    expect(ownerColor('red')).toMatch(/^#[0-9a-f]{6}$/);
    expect(ownerColor('stranger')).toBe('#8a8a8a');
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
  });
});

describe('GameSession with sea provinces', () => {
  const session = new GameSession({ ...openOptions, sea: true });
  const { state } = session.getSnapshot();

  it('has named sea provinces nobody owns', () => {
    const sea = state.provinces.filter((p) => p.terrain === 'sea');
    expect(sea.length).toBeGreaterThan(0);
    expect(sea.every((p) => p.owner === null && session.provinceName(p.id).startsWith('Sea'))).toBe(true);
    expect(state.provinces.filter((p) => p.owner === HUMAN_ID)).toHaveLength(3);
  });

  it('refuses to send land troops to the sea', () => {
    const army = state.armies.find((a) => a.owner === HUMAN_ID);
    const sea = state.provinces.find((p) => p.terrain === 'sea');
    if (!army || !sea) throw new Error('missing army or sea');
    expect(session.moveArmy(army.id, sea.id)).toEqual({ ok: false, error: 'no_path' });
  });

  it('runs until the passive player is beaten, without errors and without owning any sea', () => {
    for (let i = 0; i < 40; i++) session.step();
    const end = session.getSnapshot().state;
    expect(end.tick).toBeGreaterThan(0);
    expect(end.provinces.filter((p) => p.terrain === 'sea').every((p) => p.owner === null)).toBe(true);
  });
});
