import {
  baseRuleset,
  createGame,
  duelMap,
  orderOfferTrade,
  orderPropose,
  orderSendMessage,
  type GameState,
} from '@supremacy/sim';
import { describe, expect, it } from 'vitest';
import { bundleIsEmpty, conversationsFor, interceptedChats, newestMessage, parseBundle, totalAttention } from './chat-model';
import { marketBook, totalFor } from './market-view';

const rules = baseRuleset;
const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
  mnorth: 'green',
};

function game(): GameState {
  return createGame({
    map: duelMap,
    rules,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
      { id: 'green', name: 'Green' },
    ],
    owners,
    armies: [],
    stockpiles: { red: { money: 5000, grain: 5000 }, blue: { money: 5000, grain: 5000 } },
  });
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

describe('conversations', () => {
  it('lists every other player, even before the first message', () => {
    const list = conversationsFor(game(), 'red', {});
    expect(list.map((c) => c.other).sort()).toEqual(['blue', 'green']);
    expect(list.every((c) => c.chat === null && c.unread === 0)).toBe(true);
  });

  it('counts unread messages and open offers, and puts what needs attention first', () => {
    let state = game();
    state = ok(orderSendMessage(state, rules, 'blue', 'red', 'hello')).state;
    state = ok(orderPropose(state, rules, 'blue', 'red', 'truce')).state;
    state = ok(orderOfferTrade(state, rules, 'blue', 'red', { resources: { money: 100 }, provinces: [] }, { resources: {}, provinces: [] })).state;
    const [first] = conversationsFor(state, 'red', {});
    expect(first).toMatchObject({ other: 'blue', unread: 3, pending: 2 });
    expect(totalAttention(conversationsFor(state, 'red', {}))).toBe(5);

    // Reading everything clears the unread count (the offers still wait for an answer).
    const read = { [first!.id]: newestMessage(first!.chat) };
    expect(conversationsFor(state, 'red', read)[0]).toMatchObject({ unread: 0, pending: 2 });
    // Your own messages are never unread, and the offers of somebody else's chat are not yours.
    expect(conversationsFor(state, 'blue', {})[0]).toMatchObject({ other: 'red', unread: 0, pending: 0 });
  });

  it('keeps overheard chats apart from the player\'s own', () => {
    const state = ok(orderSendMessage(game(), rules, 'blue', 'green', 'psst')).state;
    expect(conversationsFor(state, 'red', {}).every((c) => c.chat === null)).toBe(true);
    expect(interceptedChats(state, 'red')).toHaveLength(1); // (the raw state: `viewFor` is what filters it in a game)
    expect(interceptedChats(state, 'blue')).toEqual([]);
  });
});

describe('deal form helpers', () => {
  it('turns what is typed into a bundle, ignoring empty and invalid amounts', () => {
    const bundle = parseBundle({ money: '1500', grain: '', iron: 'abc', wood: '-4', coal: '2,5' }, ['b', 'a']);
    expect(bundle).toEqual({ resources: { money: 1500, coal: 2.5 }, provinces: ['a', 'b'] });
    expect(bundleIsEmpty(bundle)).toBe(false);
    expect(bundleIsEmpty(parseBundle({ money: '0' }, []))).toBe(true);
  });
});

describe('market board', () => {
  it('splits the book of a good in sellers (cheapest first) and buyers (best payer first)', () => {
    let state = game();
    const offer = (owner: string, give: string, giveAmount: number, want: string, wantAmount: number) => {
      state = ok(
        // Placed straight on the book (the order functions would trade them against each other).
        { ok: true as const, state: { ...state, market: [...state.market, { id: `order-${state.market.length + 1}`, owner, give: { resource: give, amount: giveAmount }, want: { resource: want, amount: wantAmount }, expiresAt: 99 }] } },
      ).state;
    };
    offer('blue', 'grain', 2000, 'money', 2000); // 1000 per 1k
    offer('red', 'grain', 1000, 'money', 800); // 800 per 1k
    offer('blue', 'money', 1500, 'grain', 2000); // buys at 750 per 1k
    offer('red', 'money', 1800, 'grain', 2000); // buys at 900 per 1k
    offer('blue', 'iron', 1000, 'grain', 1000); // barter: not on this board

    const book = marketBook(state, 'grain', 'money', 'red');
    expect(book.forSale.map((l) => l.pricePerUnit)).toEqual([800, 1000]);
    expect(book.wanted.map((l) => l.pricePerUnit)).toEqual([900, 750]);
    expect(book.bestSale).toBe(800);
    expect(book.bestBuy).toBe(900);
    expect(book.forSale[0]!.mine).toBe(true);
    expect(marketBook(state, 'coal', 'money', 'red')).toMatchObject({ forSale: [], wanted: [], bestSale: null, bestBuy: null });
  });

  it('prices an amount per 1k units', () => {
    expect(totalFor(2000, 800)).toBe(1600);
    expect(totalFor(500, 1000)).toBe(500);
  });
});
