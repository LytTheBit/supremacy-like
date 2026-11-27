import type { GameEvent, GameState, MarketOrder, PlayerId, ResourceId, Ruleset } from './types';

/**
 * Market.
 *
 * A barter order book between players. There is no money in the game, so an order says what the
 * player gives and what they want in return ("2000 grain for 1500 iron"). The exchange works like
 * a continuous order book:
 *
 *  - Placing an order takes what is offered out of the stockpile at once and holds it in the order
 *    (so nobody can spend the same resources twice).
 *  - The new order is matched right away against the open orders of other players that want what
 *    it gives and give what it wants, at a price that suits both. The best price for the new order
 *    comes first (ties: the older order), and every trade happens at the price of the OLDER order,
 *    as in a real exchange, so the one who posted first is never worse off than they asked.
 *  - Trades can be partial. An order keeps its price while it is filled (both of its amounts shrink
 *    in the same proportion). What cannot be traded stays on the book as an open order.
 *  - Orders never cross each other while they rest on the book: any crossing was traded the moment
 *    the second one arrived. The exception is a player's own orders, which never trade with each other.
 *  - An order can be cancelled (what is left comes back) and it expires after `market.orderTicks`
 *    (what is left comes back too). A leftover smaller than `market.minAmount` is not kept: it
 *    goes back to its owner.
 *
 * The book is public: everybody sees every order, its owner and its price (it is an exchange, and
 * fog of war does not hide it). Anyone can trade with anyone, even a player they are at war with.
 * Nothing is random. All orders are pure: the input state is never modified.
 */

/** Amounts below this are rounding dust. */
const EPSILON = 1e-6;

export type MarketError =
  | 'game_over'
  | 'market_unavailable'
  | 'player_not_found'
  | 'player_eliminated'
  | 'unknown_resource'
  | 'same_resource'
  | 'invalid_amount'
  | 'amount_too_small'
  | 'too_many_orders'
  | 'insufficient_resources'
  | 'order_not_found'
  | 'not_owner'
  | 'own_order';

export type MarketResult = { ok: true; state: GameState } | { ok: false; error: MarketError };

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The open orders of a player, older first. */
export function ordersOf(state: GameState, playerId: PlayerId): MarketOrder[] {
  return state.market.filter((o) => o.owner === playerId);
}

/** How much of the wanted resource the order asks for per unit it gives. */
export function orderPrice(order: MarketOrder): number {
  return order.want.amount / order.give.amount;
}

/** True when `taker` could trade with `maker` (the maker offers at least what the taker asks for). */
function crosses(taker: MarketOrder, maker: MarketOrder): boolean {
  return (
    maker.owner !== taker.owner &&
    maker.give.resource === taker.want.resource &&
    maker.want.resource === taker.give.resource &&
    // maker.give / maker.want >= taker.want / taker.give, written without divisions
    // (with a hair of tolerance for rounding).
    maker.give.amount * taker.give.amount >= taker.want.amount * maker.want.amount * (1 - 1e-9)
  );
}

// ---------------------------------------------------------------------------
// Internals (mutate the private copy given by the caller)
// ---------------------------------------------------------------------------

/**
 * Events caused by an order are stamped with the tick in which they take effect (the next one),
 * so tick() can tell them apart from the events of the previous tick and keeps them.
 */
function orderTick(state: GameState): number {
  return state.tick + 1;
}

function credit(state: GameState, playerId: PlayerId, resource: ResourceId, amount: number): void {
  if (amount <= 0) return;
  const player = state.players.find((p) => p.id === playerId);
  if (player) player.stockpile[resource] = (player.stockpile[resource] ?? 0) + amount;
}

/** Below this a leftover is not worth keeping as an order. */
function dustLimit(rules: Ruleset): number {
  return Math.max(EPSILON, rules.market?.minAmount ?? 0);
}

type TradeEvent = Extract<GameEvent, { type: 'market_trade' }>;

/**
 * Trades the new order (`taker`) against the open orders of the book until it is filled or nothing
 * crosses any more. `taker` is not on the book yet. Settles the stockpiles and writes the events.
 */
function matchOrder(state: GameState, rules: Ruleset, taker: MarketOrder): void {
  const limit = dustLimit(rules);
  const price = taker.want.amount / taker.give.amount; // the taker never accepts less than this
  const takerEvents: TradeEvent[] = [];

  while (taker.give.amount >= limit) {
    // Best maker for the taker: the one that gives the most per unit (older first among equals).
    let best: MarketOrder | null = null;
    for (const maker of state.market) {
      if (!crosses(taker, maker)) continue;
      if (!best || maker.give.amount / maker.want.amount > best.give.amount / best.want.amount) best = maker;
    }
    if (!best) break;
    const maker = best;

    // x: how much of the taker's resource changes hands; y: how much of the maker's resource, at the maker's price.
    const x = Math.min(taker.give.amount, maker.want.amount);
    const y = x >= maker.want.amount ? maker.give.amount : Math.min(maker.give.amount, (x * maker.give.amount) / maker.want.amount);

    credit(state, maker.owner, taker.give.resource, x);
    credit(state, taker.owner, maker.give.resource, y);
    maker.want.amount -= x;
    maker.give.amount -= y;
    taker.give.amount -= x;
    taker.want.amount = price * taker.give.amount; // the limit price of the taker does not change

    const makerDone = maker.want.amount < EPSILON || maker.give.amount < limit;
    if (makerDone) {
      credit(state, maker.owner, maker.give.resource, maker.give.amount); // dust goes home
      state.market = state.market.filter((o) => o.id !== maker.id);
    }
    state.events.push({
      tick: orderTick(state),
      type: 'market_trade',
      orderId: maker.id,
      owner: maker.owner,
      gave: { resource: maker.give.resource, amount: y },
      got: { resource: taker.give.resource, amount: x },
      filled: makerDone,
    });
    takerEvents.push({
      tick: orderTick(state),
      type: 'market_trade',
      orderId: taker.id,
      owner: taker.owner,
      gave: { resource: taker.give.resource, amount: x },
      got: { resource: maker.give.resource, amount: y },
      filled: false,
    });
  }

  const last = takerEvents[takerEvents.length - 1];
  if (last && taker.give.amount < limit) last.filled = true;
  state.events.push(...takerEvents);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Offers `giveAmount` of a resource for `wantAmount` of another. The offer is paid at once and
 * traded immediately against whatever crosses it; the rest stays open as an order (only if the
 * player is within `maxOrders` and the rest is at least `minAmount`, else the rest comes back).
 */
export function orderMarketOffer(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  give: ResourceId,
  giveAmount: number,
  want: ResourceId,
  wantAmount: number,
): MarketResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const market = rules.market;
  if (!market) return { ok: false, error: 'market_unavailable' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'player_not_found' };
  if (state.eliminated.includes(playerId)) return { ok: false, error: 'player_eliminated' };
  if (!rules.resources.includes(give) || !rules.resources.includes(want)) return { ok: false, error: 'unknown_resource' };
  if (give === want) return { ok: false, error: 'same_resource' };
  if (!(Number.isFinite(giveAmount) && giveAmount > 0 && Number.isFinite(wantAmount) && wantAmount > 0)) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (giveAmount < market.minAmount) return { ok: false, error: 'amount_too_small' };
  if ((player.stockpile[give] ?? 0) < giveAmount) return { ok: false, error: 'insufficient_resources' };

  const next = structuredClone(state);
  const nextPlayer = next.players.find((p) => p.id === playerId);
  if (!nextPlayer) return { ok: false, error: 'player_not_found' };
  nextPlayer.stockpile[give] = (nextPlayer.stockpile[give] ?? 0) - giveAmount;

  const order: MarketOrder = {
    id: `mkt-${next.nextId}`,
    owner: playerId,
    give: { resource: give, amount: giveAmount },
    want: { resource: want, amount: wantAmount },
    expiresAt: next.tick + market.orderTicks,
  };
  next.nextId += 1;
  matchOrder(next, rules, order);

  if (order.give.amount < dustLimit(rules)) {
    credit(next, playerId, give, order.give.amount); // filled (or nothing worth keeping is left)
    return { ok: true, state: next };
  }
  if (ordersOf(next, playerId).length >= market.maxOrders) return { ok: false, error: 'too_many_orders' };
  next.market.push(order);
  return { ok: true, state: next };
}

/**
 * Takes an offer of another player as it stands: places the mirror order (gives what they want,
 * wants what they give). It trades at their price, or at a better one if the book has it. Fails
 * with `insufficient_resources` when the player cannot pay for all of it.
 */
export function orderMarketAccept(state: GameState, rules: Ruleset, playerId: PlayerId, orderId: string): MarketResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const order = state.market.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.owner === playerId) return { ok: false, error: 'own_order' };
  return orderMarketOffer(state, rules, playerId, order.want.resource, order.want.amount, order.give.resource, order.give.amount);
}

/** Withdraws an order of the player: what is left of the offer comes back. */
export function orderMarketCancel(state: GameState, playerId: PlayerId, orderId: string): MarketResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const order = state.market.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.owner !== playerId) return { ok: false, error: 'not_owner' };

  const next = structuredClone(state);
  next.market = next.market.filter((o) => o.id !== orderId);
  credit(next, playerId, order.give.resource, order.give.amount);
  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * One tick of the market (a phase of `tick()`): orders that ran out of time are closed and what is
 * left of them goes back to its owner; orders of eliminated players just vanish.
 * Mutates the given state, which is always the private copy created by tick().
 */
export function processMarket(state: GameState): void {
  if (state.market.length === 0) return;
  const open: MarketOrder[] = [];
  for (const order of state.market) {
    if (state.eliminated.includes(order.owner)) continue;
    if (state.tick >= order.expiresAt) {
      credit(state, order.owner, order.give.resource, order.give.amount);
      state.events.push({
        tick: state.tick,
        type: 'market_order_expired',
        orderId: order.id,
        owner: order.owner,
        refund: { resource: order.give.resource, amount: order.give.amount },
      });
      continue;
    }
    open.push(order);
  }
  state.market = open;
}
