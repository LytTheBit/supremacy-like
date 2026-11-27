import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  duelMap,
  isEventVisible,
  orderMarketAccept,
  orderMarketCancel,
  orderMarketOffer,
  orderPrice,
  ordersOf,
  tick,
  viewFor,
  type GameState,
  type MarketOrder,
  type Ruleset,
} from '../src';

const rules = baseRuleset;
const market = rules.market!;

const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
};

/** Red has grain and wood, blue has iron and coal. They are at war (the default): the market does not care. */
function game(ruleset: Ruleset = rules, extra: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({
    map: duelMap,
    rules: ruleset,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
      { id: 'green', name: 'Green' },
    ],
    owners,
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    stockpiles: {
      red: { grain: 20000, wood: 20000 },
      blue: { iron: 20000, coal: 20000, grain: 1000 },
      green: { grain: 20000, iron: 20000 },
    },
    ...extra,
  });
}

function stock(state: GameState, player: string, resource: string): number {
  return state.players.find((p) => p.id === player)?.stockpile[resource] ?? 0;
}

/** Everything in the world of one resource: stockpiles plus what is held in open orders. */
function total(state: GameState, resource: string): number {
  const held = state.market.filter((o) => o.give.resource === resource).reduce((s, o) => s + o.give.amount, 0);
  return state.players.reduce((s, p) => s + (p.stockpile[resource] ?? 0), 0) + held;
}

function offer(state: GameState, player: string, give: string, giveAmount: number, want: string, wantAmount: number): GameState {
  const result = orderMarketOffer(state, rules, player, give, giveAmount, want, wantAmount);
  if (!result.ok) throw new Error(`offer failed: ${result.error}`);
  return result.state;
}

function only(state: GameState): MarketOrder {
  expect(state.market).toHaveLength(1);
  return state.market[0] as MarketOrder;
}

describe('placing an order', () => {
  it('takes the offer out of the stockpile and holds it on the book', () => {
    const before = game();
    const after = offer(before, 'red', 'grain', 4000, 'iron', 3000);
    expect(stock(after, 'red', 'grain')).toBe(16000);
    const order = only(after);
    expect(order).toMatchObject({
      owner: 'red',
      give: { resource: 'grain', amount: 4000 },
      want: { resource: 'iron', amount: 3000 },
      expiresAt: after.tick + market.orderTicks,
    });
    expect(orderPrice(order)).toBeCloseTo(0.75);
    expect(ordersOf(after, 'red')).toHaveLength(1);
    expect(ordersOf(after, 'blue')).toHaveLength(0);
    expect(after.nextId).toBe(before.nextId + 1);
  });

  it('never modifies the state it is given', () => {
    const before = game();
    const snapshot = structuredClone(before);
    offer(before, 'red', 'grain', 4000, 'iron', 3000);
    expect(before).toEqual(snapshot);
  });

  it('refuses what the rules refuse, with the error code', () => {
    const state = game();
    const fail = (...args: Parameters<typeof orderMarketOffer> extends [unknown, unknown, ...infer R] ? R : never) => {
      const result = orderMarketOffer(state, rules, ...args);
      return result.ok ? 'ok' : result.error;
    };
    expect(fail('nobody', 'grain', 1000, 'iron', 1000)).toBe('player_not_found');
    expect(fail('red', 'gold', 1000, 'iron', 1000)).toBe('unknown_resource');
    expect(fail('red', 'grain', 1000, 'gold', 1000)).toBe('unknown_resource');
    expect(fail('red', 'grain', 1000, 'grain', 1000)).toBe('same_resource');
    expect(fail('red', 'grain', 0, 'iron', 1000)).toBe('invalid_amount');
    expect(fail('red', 'grain', 1000, 'iron', 0)).toBe('invalid_amount');
    expect(fail('red', 'grain', -5, 'iron', 1000)).toBe('invalid_amount');
    expect(fail('red', 'grain', Number.NaN, 'iron', 1000)).toBe('invalid_amount');
    expect(fail('red', 'grain', Infinity, 'iron', 1000)).toBe('invalid_amount');
    expect(fail('red', 'grain', market.minAmount - 1, 'iron', 1000)).toBe('amount_too_small');
    expect(fail('red', 'grain', 20001, 'iron', 1000)).toBe('insufficient_resources');
    expect(fail('red', 'iron', 1000, 'grain', 1000)).toBe('insufficient_resources'); // red has no iron
  });

  it('is unavailable in a game without a market', () => {
    const noMarket: Ruleset = { ...rules, id: 'no-market', market: undefined };
    const state = game(noMarket);
    expect(orderMarketOffer(state, noMarket, 'red', 'grain', 1000, 'iron', 1000)).toEqual({ ok: false, error: 'market_unavailable' });
  });

  it('is refused for an eliminated player and after the game is over', () => {
    const eliminated = { ...game(), eliminated: ['red'] };
    expect(orderMarketOffer(eliminated, rules, 'red', 'grain', 1000, 'iron', 1000)).toEqual({ ok: false, error: 'player_eliminated' });
    const over = { ...game(), outcome: { winner: 'blue', winners: ['blue'], reason: 'domination' as const } };
    expect(orderMarketOffer(over, rules, 'red', 'grain', 1000, 'iron', 1000)).toEqual({ ok: false, error: 'game_over' });
    expect(orderMarketCancel(over, 'red', 'mkt-1')).toEqual({ ok: false, error: 'game_over' });
    expect(orderMarketAccept(over, rules, 'red', 'mkt-1')).toEqual({ ok: false, error: 'game_over' });
  });

  it('limits the open orders per player, but a filled order never counts', () => {
    let state = game();
    for (let i = 0; i < market.maxOrders; i++) state = offer(state, 'red', 'wood', 1000, 'iron', 5000 + i);
    const full = orderMarketOffer(state, rules, 'red', 'wood', 1000, 'iron', 9000);
    expect(full).toEqual({ ok: false, error: 'too_many_orders' });
    // Another player is not affected.
    expect(orderMarketOffer(state, rules, 'blue', 'iron', 1000, 'wood', 9000).ok).toBe(true);
    // An order that trades completely on arrival needs no slot: blue's iron (cheap) fills red's cheapest order.
    const traded = orderMarketOffer(state, rules, 'blue', 'iron', 5000, 'wood', 1000);
    expect(traded.ok).toBe(true);
  });
});

describe('trading', () => {
  it('trades two orders that agree, at once, and leaves nothing on the book', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    state = offer(state, 'blue', 'iron', 3000, 'grain', 4000);
    expect(state.market).toEqual([]);
    expect(stock(state, 'red', 'grain')).toBe(16000);
    expect(stock(state, 'red', 'iron')).toBe(3000);
    expect(stock(state, 'blue', 'iron')).toBe(17000);
    expect(stock(state, 'blue', 'grain')).toBe(1000 + 4000);
  });

  it('trades at the price of the older order: the newcomer gets the better deal', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000); // red asks 3000 iron
    // Blue would pay 1 iron per grain, but the older order asks only 0.75: that is the price.
    state = offer(state, 'blue', 'iron', 4000, 'grain', 4000);
    expect(stock(state, 'blue', 'grain')).toBe(1000 + 4000);
    expect(stock(state, 'red', 'iron')).toBe(3000);
    // Blue paid 3000 iron for all the grain; the other 1000 iron wait on the book at blue's own limit price.
    const rest = only(state);
    expect(rest.owner).toBe('blue');
    expect(rest.give.amount).toBeCloseTo(1000);
    expect(rest.want.amount).toBeCloseTo(1000);
    expect(stock(state, 'blue', 'iron')).toBe(20000 - 4000);
  });

  it('does not trade when the prices do not meet', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    state = offer(state, 'blue', 'iron', 3000, 'grain', 4001);
    expect(state.market).toHaveLength(2);
    expect(stock(state, 'red', 'iron')).toBe(0);
  });

  it('does not trade other resources', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    state = offer(state, 'blue', 'coal', 3000, 'grain', 4000);
    expect(state.market).toHaveLength(2);
  });

  it('fills a bigger order in part: it keeps its price and what is left stays open', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 10000, 'iron', 5000); // price 0.5 iron per grain
    state = offer(state, 'blue', 'iron', 2000, 'grain', 4000);
    // Blue gets 4000 grain for 2000 iron; red's order is now 6000 grain for 3000 iron.
    expect(stock(state, 'blue', 'grain')).toBe(1000 + 4000);
    expect(stock(state, 'red', 'iron')).toBe(2000);
    const order = only(state);
    expect(order.give.amount).toBeCloseTo(6000);
    expect(order.want.amount).toBeCloseTo(3000);
    expect(orderPrice(order)).toBeCloseTo(0.5);
    expect(order.expiresAt).toBe(game().tick + market.orderTicks); // a partial fill does not renew it
  });

  it('keeps what a big newcomer cannot trade as an open order with the same limit price', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 2000, 'iron', 1000);
    state = offer(state, 'blue', 'iron', 3000, 'grain', 6000); // wants 2 grain per iron
    // The only counterpart gives 2 grain per iron: it fits exactly. Blue gives 1000 iron for 2000 grain
    // and the rest (2000 iron for 4000 grain) waits for somebody.
    expect(stock(state, 'red', 'iron')).toBe(1000);
    expect(stock(state, 'blue', 'grain')).toBe(1000 + 2000);
    const order = only(state);
    expect(order.owner).toBe('blue');
    expect(order.give.amount).toBeCloseTo(2000);
    expect(order.want.amount).toBeCloseTo(4000);
    expect(stock(state, 'blue', 'iron')).toBe(20000 - 3000);
  });

  it('serves the best price first, and the older order among equal prices', () => {
    let state = game();
    state = offer(state, 'green', 'grain', 2000, 'iron', 1500); // 0.75, the oldest
    state = offer(state, 'red', 'grain', 2000, 'iron', 1000); // 0.5: better for the buyer
    state = offer(state, 'green', 'grain', 2000, 'iron', 1000); // 0.5, newer than red's
    state = offer(state, 'blue', 'iron', 1000, 'grain', 2000); // takes exactly one order
    // Red's order (best price, older of the two) is the one that traded.
    expect(stock(state, 'red', 'iron')).toBe(1000);
    expect(state.market.map((o) => o.owner)).toEqual(['green', 'green']);
    expect(state.market.map((o) => orderPrice(o))).toEqual([0.75, 0.5]);
  });

  it('a big order eats through several orders of the book', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 2000, 'iron', 1000);
    state = offer(state, 'green', 'grain', 2000, 'iron', 1200);
    state = offer(state, 'blue', 'iron', 2200, 'grain', 3600); // asks 1.64 grain per iron: both orders suit it
    // 1000 iron for red's 2000 grain, 1200 iron for green's 2000 grain.
    expect(stock(state, 'blue', 'grain')).toBe(1000 + 4000);
    expect(stock(state, 'red', 'iron')).toBe(1000);
    expect(stock(state, 'green', 'iron')).toBe(20000 + 1200 - 0); // green had 20000 iron and gets 1200 more
    expect(state.market).toEqual([]);
  });

  it('never trades a player with themselves', () => {
    let state = game();
    state = offer(state, 'green', 'grain', 2000, 'iron', 1000);
    state = offer(state, 'green', 'iron', 1000, 'grain', 2000);
    expect(state.market).toHaveLength(2);
    expect(stock(state, 'green', 'grain')).toBe(18000);
  });

  it('lets players at war trade', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 2000, 'iron', 1000);
    state = offer(state, 'blue', 'iron', 1000, 'grain', 2000);
    expect(state.market).toEqual([]);
    expect(stock(state, 'red', 'iron')).toBe(1000);
  });

  it('returns a leftover too small to keep instead of leaving it on the book', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 2200, 'iron', 2200);
    state = offer(state, 'blue', 'iron', 2000, 'grain', 2000);
    // Red's order had 200 grain left (below the minimum of 500): it goes back to red, nothing stays open.
    expect(state.market).toEqual([]);
    expect(stock(state, 'red', 'grain')).toBe(20000 - 2200 + 200);
    expect(stock(state, 'red', 'iron')).toBe(2000);
  });

  it('conserves every resource through any number of trades', () => {
    let state = game();
    const before = Object.fromEntries(rules.resources.map((r) => [r, total(state, r)]));
    state = offer(state, 'red', 'grain', 7000, 'iron', 3500);
    state = offer(state, 'blue', 'iron', 1234.5, 'grain', 2000);
    state = offer(state, 'green', 'iron', 5000, 'grain', 9000);
    state = offer(state, 'blue', 'coal', 5000, 'wood', 5000);
    state = offer(state, 'red', 'wood', 6000, 'coal', 4000);
    state = offer(state, 'green', 'grain', 3000, 'iron', 100);
    for (const resource of rules.resources) expect([resource, total(state, resource)]).toEqual([resource, before[resource]]);
    for (const p of state.players) for (const r of rules.resources) expect(stock(state, p.id, r)).toBeGreaterThanOrEqual(0);
    for (const o of state.market) {
      expect(o.give.amount).toBeGreaterThan(0);
      expect(o.want.amount).toBeGreaterThan(0);
    }
  });

  it('leaves no pair of orders on the book that could still trade', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 7000, 'iron', 3500);
    state = offer(state, 'blue', 'iron', 1000, 'grain', 2500);
    state = offer(state, 'green', 'iron', 5000, 'grain', 9000);
    state = offer(state, 'blue', 'iron', 4000, 'grain', 7000);
    for (const a of state.market) {
      for (const b of state.market) {
        if (a.owner === b.owner || a.give.resource !== b.want.resource || a.want.resource !== b.give.resource) continue;
        expect(a.give.amount * b.give.amount).toBeLessThan(b.want.amount * a.want.amount * (1 - 1e-9));
      }
    }
  });

  it('tells each side about its trade, with the amounts, and only each side', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    const placed = state.events.length;
    state = offer(state, 'blue', 'iron', 3000, 'grain', 4000);
    const trades = state.events.slice(placed).filter((e) => e.type === 'market_trade');
    expect(trades).toHaveLength(2);
    const red = trades.find((e) => e.type === 'market_trade' && e.owner === 'red');
    const blue = trades.find((e) => e.type === 'market_trade' && e.owner === 'blue');
    expect(red).toMatchObject({ gave: { resource: 'grain', amount: 4000 }, got: { resource: 'iron', amount: 3000 }, filled: true, tick: state.tick + 1 });
    expect(blue).toMatchObject({ gave: { resource: 'iron', amount: 3000 }, got: { resource: 'grain', amount: 4000 }, filled: true });

    const visible = new Set<string>();
    for (const e of trades) {
      expect(isEventVisible(e, visible, 'green')).toBe(false);
      expect(isEventVisible(e, visible, e.type === 'market_trade' ? e.owner : '')).toBe(true);
    }
  });

  it('marks a trade as complete only when the order is', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 10000, 'iron', 5000);
    state = offer(state, 'blue', 'iron', 2000, 'grain', 4000);
    const trades = state.events.filter((e) => e.type === 'market_trade');
    expect(trades.find((e) => e.type === 'market_trade' && e.owner === 'red')).toMatchObject({ filled: false });
    expect(trades.find((e) => e.type === 'market_trade' && e.owner === 'blue')).toMatchObject({ filled: true });
  });

  it('keeps the events of an order for the next tick', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    state = offer(state, 'blue', 'iron', 3000, 'grain', 4000);
    const next = tick(state, rules);
    expect(next.events.filter((e) => e.type === 'market_trade')).toHaveLength(2);
    expect(tick(next, rules).events.filter((e) => e.type === 'market_trade')).toHaveLength(0);
  });
});

describe('accepting an offer', () => {
  it('takes the offer as it stands', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    const id = only(state).id;
    const result = orderMarketAccept(state, rules, 'blue', id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.market).toEqual([]);
    expect(stock(result.state, 'blue', 'grain')).toBe(1000 + 4000);
    expect(stock(result.state, 'blue', 'iron')).toBe(17000);
    expect(stock(result.state, 'red', 'iron')).toBe(3000);
  });

  it('refuses unknown offers, your own offers, and what you cannot pay', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    const id = only(state).id;
    expect(orderMarketAccept(state, rules, 'blue', 'mkt-99')).toEqual({ ok: false, error: 'order_not_found' });
    expect(orderMarketAccept(state, rules, 'red', id)).toEqual({ ok: false, error: 'own_order' });
    state = offer(state, 'green', 'iron', 20000, 'wood', 30000); // red has only 20000 wood: it cannot pay for this
    const expensive = state.market.find((o) => o.owner === 'green')?.id ?? '';
    expect(orderMarketAccept(state, rules, 'red', expensive)).toEqual({ ok: false, error: 'insufficient_resources' });
  });
});

describe('cancelling and expiring', () => {
  it('gives back what is left of the offer', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 10000, 'iron', 5000);
    state = offer(state, 'blue', 'iron', 2000, 'grain', 4000); // red's order is now 6000 grain
    const id = only(state).id;
    const result = orderMarketCancel(state, 'red', id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.market).toEqual([]);
    expect(stock(result.state, 'red', 'grain')).toBeCloseTo(20000 - 4000);
  });

  it('is only for the owner', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    const id = only(state).id;
    expect(orderMarketCancel(state, 'blue', id)).toEqual({ ok: false, error: 'not_owner' });
    expect(orderMarketCancel(state, 'red', 'mkt-99')).toEqual({ ok: false, error: 'order_not_found' });
  });

  it('expires after orderTicks and returns the offer, telling the owner', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    for (let i = 0; i < market.orderTicks - 1; i++) state = tick(state, rules);
    expect(state.market).toHaveLength(1); // still open one tick before it expires
    expect(only(state).give.amount).toBe(4000);
    const before = stock(state, 'red', 'grain');
    state = tick(state, rules);
    expect(state.market).toEqual([]);
    expect(stock(state, 'red', 'grain')).toBeGreaterThanOrEqual(before + 4000); // the offer is back (plus what the provinces made)
    const expired = state.events.find((e) => e.type === 'market_order_expired');
    expect(expired).toMatchObject({ owner: 'red', refund: { resource: 'grain', amount: 4000 } });
    if (expired) {
      expect(isEventVisible(expired, new Set(), 'red')).toBe(true);
      expect(isEventVisible(expired, new Set(), 'blue')).toBe(false);
    }
  });

  it('drops the orders of an eliminated player', () => {
    let state = game();
    state = offer(state, 'green', 'grain', 4000, 'iron', 3000); // green owns nothing: it is eliminated at the end of the tick
    state = tick(state, rules);
    expect(state.eliminated).toContain('green');
    expect(state.market).toEqual([]);
  });

});

describe('the book is public', () => {
  it('stays in the view of every player, fog of war or not', () => {
    let state = game();
    state = offer(state, 'red', 'grain', 4000, 'iron', 3000);
    const seenByBlue = viewFor(state, rules, 'blue').state;
    expect(seenByBlue.market).toEqual(state.market);
    const foggy: Ruleset = { ...rules, vision: { ...rules.vision, fog: true } };
    expect(viewFor(state, foggy, 'blue').state.market).toEqual(state.market);
  });
});

describe('the rules of the market', () => {
  it('are checked when a game is created', () => {
    const bad = (m: Partial<NonNullable<Ruleset['market']>>) => () =>
      game({ ...rules, market: { ...market, ...m } });
    expect(bad({ maxOrders: 0 })).toThrow('market.maxOrders');
    expect(bad({ maxOrders: 1.5 })).toThrow('market.maxOrders');
    expect(bad({ orderTicks: 0 })).toThrow('market.orderTicks');
    expect(bad({ minAmount: -1 })).toThrow('market.minAmount');
    expect(bad({})).not.toThrow();
  });
});
