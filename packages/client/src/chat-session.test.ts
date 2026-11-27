import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatModal } from './components/ChatModal';
import { DiplomacyPanel } from './components/DiplomacyPanel';
import { setLocale } from './i18n';
import { directChatId } from '@supremacy/sim';
import { AI_IDS, GameSession, HUMAN_ID, type SessionOptions } from './session';

const options: SessionOptions = { seed: 7, provinces: 24, medals: [], organic: 0.6 };
const AI = AI_IDS[0]!;

afterEach(() => setLocale('en'));

function chatHtml(session: GameSession, initialChat: string | null = null): string {
  const { state, chatRead } = session.getSnapshot();
  return renderToStaticMarkup(createElement(ChatModal, { session, state, chatRead, initialChat, onClose: () => {} }));
}

describe('chat in a session', () => {
  it('writes messages that show up in the conversation, and counts the AI\'s as unread', () => {
    const session = new GameSession(options);
    expect(session.sendMessage(AI, 'hello there')).toEqual({ ok: true });
    expect(session.sendMessage(AI, '   ')).toEqual({ ok: false, error: 'empty_message' });
    const html = chatHtml(session, directChatId(HUMAN_ID, AI));
    expect(html).toContain('hello there');
    expect(html).toContain('Write a message here…');
    expect(html).toContain('Offer a deal');
  });

  it('gives money to the AI at once', () => {
    const session = new GameSession(options);
    const before = session.getSnapshot().state.players.find((p) => p.id === HUMAN_ID)!.stockpile.money ?? 0;
    expect(session.gift(AI, { resources: { money: 2000 }, provinces: [] })).toEqual({ ok: true });
    const after = session.getSnapshot().state.players.find((p) => p.id === HUMAN_ID)!.stockpile.money ?? 0;
    expect(after).toBe(before - 2000);
    expect(chatHtml(session, directChatId(HUMAN_ID, AI))).toContain('made a gift');
  });

  it('shows a trade offer as a card the AI answers on its turn (a fair swap at peace, never at war)', () => {
    const session = new GameSession(options);
    expect(session.offerTrade(AI, { resources: { money: 3000 }, provinces: [] }, { resources: { grain: 1000 }, provinces: [] })).toEqual({ ok: true });
    expect(chatHtml(session, directChatId(HUMAN_ID, AI))).toContain('Waiting for an answer');
    expect(session.getSnapshot().state.trades).toHaveLength(1);

    // At war (the start of the game) the AI turns the deal down on its next turn.
    session.step();
    expect(session.getSnapshot().state.trades).toHaveLength(0);
    expect(chatHtml(session, directChatId(HUMAN_ID, AI))).toContain('Rejected');
  });

  it('answers in Italian too', () => {
    const session = new GameSession(options);
    session.propose(AI, 'truce');
    setLocale('it');
    const html = chatHtml(session, directChatId(HUMAN_ID, AI));
    expect(html).toContain('Tregua');
    expect(html).toContain('Scrivi il messaggio qui…');
    expect(html).toContain('Intercettate');
  });

  it('tracks what has been read', () => {
    const session = new GameSession(options);
    session.markChatRead('dm:a|b', 5);
    session.markChatRead('dm:a|b', 3);
    expect(session.getSnapshot().chatRead['dm:a|b']).toBe(5);
  });

  it('moves the offers of treaties to the chat: the panel only links to it', () => {
    const session = new GameSession(options);
    session.propose(AI, 'alliance');
    const { state, chatRead } = session.getSnapshot();
    const html = renderToStaticMarkup(createElement(DiplomacyPanel, { session, state, chatRead, onOpenChat: () => {} }));
    expect(html).toContain('Chat');
    expect(html).not.toContain('Propose an alliance');
  });
});
