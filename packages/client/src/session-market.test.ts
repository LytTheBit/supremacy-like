import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from './i18n';
import { GameSession, HUMAN_ID, type SessionOptions } from './session';

const options: SessionOptions = { seed: 7, provinces: 24, medals: [], organic: 0.6 };

afterEach(() => setLocale('en'));

function mine(session: GameSession, resource: string): number {
  return session.getSnapshot().state.players.find((p) => p.id === HUMAN_ID)?.stockpile[resource] ?? 0;
}

describe('GameSession market', () => {
  it('posts an offer, holds the resources, and takes them back when cancelled', () => {
    const session = new GameSession(options);
    const before = mine(session, 'grain');
    expect(session.marketOffer('grain', 4000, 'iron', 3000)).toEqual({ ok: true });

    const { market } = session.getSnapshot().state;
    expect(market).toHaveLength(1);
    expect(market[0]).toMatchObject({ owner: HUMAN_ID, give: { resource: 'grain', amount: 4000 }, want: { resource: 'iron', amount: 3000 } });
    expect(mine(session, 'grain')).toBe(before - 4000);

    const id = market[0]?.id ?? '';
    expect(session.marketCancel(id)).toEqual({ ok: true });
    expect(session.getSnapshot().state.market).toEqual([]);
    expect(mine(session, 'grain')).toBe(before);
  });

  it('refuses what the rules refuse, with the error code', () => {
    const session = new GameSession(options);
    expect(session.marketOffer('grain', 4000, 'grain', 4000)).toEqual({ ok: false, error: 'same_resource' });
    expect(session.marketOffer('grain', 10, 'iron', 10)).toEqual({ ok: false, error: 'amount_too_small' });
    expect(session.marketOffer('grain', 1e9, 'iron', 10)).toEqual({ ok: false, error: 'insufficient_resources' });
    expect(session.marketOffer('gold', 4000, 'iron', 10)).toEqual({ ok: false, error: 'unknown_resource' });
    expect(session.marketAccept('mkt-99')).toEqual({ ok: false, error: 'order_not_found' });
    expect(session.marketCancel('mkt-99')).toEqual({ ok: false, error: 'order_not_found' });
    expect(session.getSnapshot().state.market).toEqual([]);
  });

  it('cannot accept its own offer', () => {
    const session = new GameSession(options);
    session.marketOffer('grain', 4000, 'iron', 3000);
    const id = session.getSnapshot().state.market[0]?.id ?? '';
    expect(session.checkMarketAccept(id)).toBe('own_order');
    expect(session.marketAccept(id)).toEqual({ ok: false, error: 'own_order' });
  });

  it('lets the player trade with the AI, and the log tells it in the current language', () => {
    const session = new GameSession(options);
    let traded = false;
    for (let i = 0; i < 150 && !traded; i++) {
      session.step();
      const offer = session.getSnapshot().state.market.find((o) => o.owner !== HUMAN_ID && session.checkMarketAccept(o.id) === null);
      if (offer) traded = session.marketAccept(offer.id).ok;
    }
    expect(traded).toBe(true);
    const line = session.getSnapshot().log.find((e) => e.text().startsWith('Market: you gave'));
    expect(line).toBeUndefined(); // the trade event of an order shows up with the next tick
    session.step();
    const log = session.getSnapshot().log.find((e) => e.text().startsWith('Market: you gave'));
    expect(log).toBeDefined();
    setLocale('it');
    expect(log?.text().startsWith('Mercato: hai dato')).toBe(true);
  });
});
