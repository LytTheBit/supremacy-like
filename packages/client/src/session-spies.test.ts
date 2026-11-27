import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from './i18n';
import { GameSession, HUMAN_ID, type SessionOptions } from './session';

const options: SessionOptions = { seed: 7, provinces: 24, medals: [], organic: 0.6 };

afterEach(() => setLocale('en'));

function enemyProvince(session: GameSession): string {
  const province = session.getSnapshot().state.provinces.find((p) => p.owner === 'blue');
  if (!province) throw new Error('no enemy province');
  return province.id;
}

describe('GameSession espionage', () => {
  it('sends a spy, follows it into place and shows what it sees', () => {
    const session = new GameSession(options);
    const target = enemyProvince(session);
    expect(session.getSnapshot().visible).not.toContain(target);
    expect(session.checkSpy(target)).toBeNull();

    expect(session.spy(target)).toEqual({ ok: true });
    expect(session.getSnapshot().state.spies).toHaveLength(1);
    expect(session.getSnapshot().visible).not.toContain(target); // still travelling

    const infiltrate = session.rules.espionage?.infiltrateTicks ?? 0;
    for (let i = 0; i < infiltrate; i++) session.step();
    expect(session.getSnapshot().state.spies[0]?.infiltrationLeft).toBe(0);
    expect(session.getSnapshot().visible).toContain(target);
    expect(session.getSnapshot().log.some((e) => e.text().includes('spy is in place'))).toBe(true);
  });

  it('refuses what the rules refuse, with the error code', () => {
    const session = new GameSession(options);
    const own = session.getSnapshot().state.provinces.find((p) => p.owner === HUMAN_ID)?.id ?? '';
    expect(session.checkSpy(own)).toBe('not_spyable');
    expect(session.spy(own)).toEqual({ ok: false, error: 'not_spyable' });

    const target = enemyProvince(session);
    expect(session.spy(target)).toEqual({ ok: true });
    expect(session.spy(target)).toEqual({ ok: false, error: 'already_spied' });
  });

  it('gives missions and recalls the spy', () => {
    const session = new GameSession(options);
    const target = enemyProvince(session);
    session.spy(target);
    const spyId = session.getSnapshot().state.spies[0]?.id ?? '';
    expect(session.spyMission(spyId, { kind: 'disinformation' })).toEqual({ ok: false, error: 'spy_not_ready' });

    const infiltrate = session.rules.espionage?.infiltrateTicks ?? 0;
    for (let i = 0; i < infiltrate; i++) session.step();
    expect(session.spyMission(spyId, { kind: 'disinformation' })).toEqual({ ok: true });
    expect(session.getSnapshot().state.spies[0]?.mission?.kind).toBe('disinformation');

    expect(session.recallSpy(spyId)).toEqual({ ok: true });
    expect(session.getSnapshot().state.spies).toEqual([]);
  });

  it('never shows the spies of the AI', () => {
    const session = new GameSession({ ...options, fog: false });
    for (let i = 0; i < 80; i++) session.step();
    expect(session.getSnapshot().state.spies.every((s) => s.owner === HUMAN_ID)).toBe(true);
  });
});

describe('GameSession language', () => {
  it('writes the log again in the new language', () => {
    const session = new GameSession(options);
    const target = enemyProvince(session);
    session.spy(target);
    for (let i = 0; i < (session.rules.espionage?.infiltrateTicks ?? 0); i++) session.step();

    const entry = session.getSnapshot().log.find((e) => e.text().includes('spy'));
    expect(entry?.text()).toBe(`Your spy is in place at ${session.provinceName(target)}`);
    setLocale('it');
    expect(entry?.text()).toBe(`La tua spia è in posizione a ${session.provinceName(target)}`);
  });

  it('names sea provinces in the current language', () => {
    const session = new GameSession({ ...options, sea: true, fog: false });
    const sea = session.getSnapshot().state.provinces.find((p) => p.terrain === 'sea');
    expect(sea).toBeDefined();
    const id = sea?.id ?? '';
    expect(session.provinceName(id)).toMatch(/^Sea \d+$/);
    setLocale('it');
    expect(session.provinceName(id)).toMatch(/^Mare \d+$/);
  });
});
