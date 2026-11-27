import type { GameState, MarketOrder, PlayerId, ResourceId } from '@supremacy/sim';

/**
 * The market seen as a money market: for one good, who sells it for money and who wants to buy it.
 * (The market itself only knows offers of one resource for another; money is one of the resources.)
 */

/** Prices are shown per this many units: amounts in the game are in the thousands. */
export const PRICE_UNIT = 1000;

export interface BookLine {
  order: MarketOrder;
  mine: boolean;
  /** Units of the good on offer (what is left of the order). */
  amount: number;
  /** Money for all of it. */
  total: number;
  /** Money for `PRICE_UNIT` units of the good. */
  pricePerUnit: number;
}

export interface Book {
  /** People selling the good for money, cheapest first. */
  forSale: BookLine[];
  /** People who want the good and pay in money, the best payer first. */
  wanted: BookLine[];
  bestSale: number | null;
  bestBuy: number | null;
}

function line(order: MarketOrder, humanId: PlayerId, goodIsGiven: boolean): BookLine {
  const amount = goodIsGiven ? order.give.amount : order.want.amount;
  const total = goodIsGiven ? order.want.amount : order.give.amount;
  return { order, mine: order.owner === humanId, amount, total, pricePerUnit: amount > 0 ? (total / amount) * PRICE_UNIT : 0 };
}

export function marketBook(state: GameState, good: ResourceId, currency: ResourceId, humanId: PlayerId): Book {
  const forSale = state.market
    .filter((o) => o.give.resource === good && o.want.resource === currency)
    .map((o) => line(o, humanId, true))
    .sort((a, b) => a.pricePerUnit - b.pricePerUnit || a.order.id.localeCompare(b.order.id, 'en', { numeric: true }));
  const wanted = state.market
    .filter((o) => o.give.resource === currency && o.want.resource === good)
    .map((o) => line(o, humanId, false))
    .sort((a, b) => b.pricePerUnit - a.pricePerUnit || a.order.id.localeCompare(b.order.id, 'en', { numeric: true }));
  return {
    forSale,
    wanted,
    bestSale: forSale[0]?.pricePerUnit ?? null,
    bestBuy: wanted[0]?.pricePerUnit ?? null,
  };
}

/** The money for `amount` units of a good at a price per `PRICE_UNIT` units. */
export function totalFor(amount: number, pricePerUnit: number): number {
  return Math.round((amount / PRICE_UNIT) * pricePerUnit);
}
