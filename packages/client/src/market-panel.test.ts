import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketPanel } from './components/MarketPanel';
import { setLocale } from './i18n';
import { GameSession, type SessionOptions } from './session';

const options: SessionOptions = { seed: 7, provinces: 24, medals: [], organic: 0.6 };

afterEach(() => setLocale('en'));

function render(session: GameSession): string {
  return renderToStaticMarkup(createElement(MarketPanel, { session, state: session.getSnapshot().state }));
}

describe('MarketPanel', () => {
  it('shows the empty book, the form and the limits', () => {
    const html = render(new GameSession(options));
    expect(html).toContain('Market');
    expect(html).toContain('Your money: 15.0k');
    expect(html).toContain('Nobody is selling.');
    expect(html).toContain('Nobody is buying.');
    expect(html).toContain('Place a buy offer');
    expect(html).toContain('You have no open offers.');
    expect(html).toContain('Open offers: 0/5');
    expect(html).toContain('New offer');
    expect(html).toContain('You must give at least 500.');
  });

  it('shows an open offer with its price and expiry, in the current language', () => {
    const session = new GameSession(options);
    session.marketOffer('grain', 4000, 'iron', 3000);
    const html = render(session);
    expect(html).toContain('You give 4.0k Grain, you want 3.0k Iron');
    expect(html).toContain('1 Grain = 0.75 Iron');
    expect(html).toContain('expires in 40 ticks');
    expect(html).toContain('Cancel');

    setLocale('it');
    const italian = render(session);
    expect(italian).toContain('Mercato');
    expect(italian).toContain('Dai 4,0k Grano, vuoi 3,0k Ferro');
    expect(italian).toContain('1 Grano = 0,75 Ferro');
    expect(italian).toContain('scade tra 40 tick');
  });

  it('shows a sale for money on the board of its good, with the price per 1k', () => {
    const session = new GameSession(options);
    session.marketOffer('wood', 4000, 'money', 3000); // wood is the good the board opens on
    const html = render(session);
    expect(html).toContain('750 per 1k');
    expect(html).toContain('You: 4.0k Wood for 3.0k Money');
  });

  it('renders nothing in a game without a market', () => {
    const session = new GameSession(options);
    const bare = Object.create(session, { rules: { value: { ...session.rules, market: undefined } } }) as GameSession;
    expect(renderToStaticMarkup(createElement(MarketPanel, { session: bare, state: session.getSnapshot().state }))).toBe('');
  });
});
