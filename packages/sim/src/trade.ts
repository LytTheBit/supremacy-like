import { postDirect, setOfferStatus, chatRules } from './chat';
import type { Bundle, GameState, PlayerId, ProvinceId, ResourceId, Ruleset, Trade } from './types';

/**
 * Direct deals between two players: trades (each side gives something) and gifts (one side gives).
 * What changes hands is a `Bundle`: resources, money included, and whole provinces. Offers are
 * cards in the chat of the two players; nothing is held back while an offer is open, so
 * everything is checked again when it is accepted. All orders are pure.
 */

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

export function emptyBundle(): Bundle {
  return { resources: {}, provinces: [] };
}

/** True when a bundle holds nothing. */
export function isEmptyBundle(bundle: Bundle): boolean {
  return bundle.provinces.length === 0 && Object.values(bundle.resources).every((amount) => !(amount > 0));
}

/** A copy of a bundle without zero amounts, with provinces sorted. */
function normalizedBundle(bundle: Bundle): Bundle {
  const resources: Record<ResourceId, number> = {};
  for (const [resource, amount] of Object.entries(bundle.resources)) {
    if (amount > 0) resources[resource] = amount;
  }
  return { resources, provinces: [...new Set(bundle.provinces)].sort() };
}

type BundleProblem = 'unknown_resource' | 'invalid_amount' | 'province_not_found';

function bundleProblem(state: GameState, rules: Ruleset, bundle: Bundle): BundleProblem | null {
  for (const [resource, amount] of Object.entries(bundle.resources)) {
    if (!rules.resources.includes(resource)) return 'unknown_resource';
    if (!Number.isFinite(amount) || amount < 0) return 'invalid_amount';
  }
  for (const id of bundle.provinces) {
    if (!state.provinces.some((p) => p.id === id)) return 'province_not_found';
  }
  return null;
}

function stockOf(state: GameState, playerId: PlayerId, resource: ResourceId): number {
  return state.players.find((p) => p.id === playerId)?.stockpile[resource] ?? 0;
}

function hasResources(state: GameState, playerId: PlayerId, bundle: Bundle): boolean {
  return Object.entries(bundle.resources).every(([resource, amount]) => stockOf(state, playerId, resource) >= amount);
}

function ownsProvinces(state: GameState, playerId: PlayerId, ids: ProvinceId[]): boolean {
  return ids.every((id) => state.provinces.find((p) => p.id === id)?.owner === playerId);
}

/** A player must keep at least one province, or they would be out of the game by their own hand. */
function keepsAProvince(state: GameState, playerId: PlayerId, giving: ProvinceId[]): boolean {
  if (giving.length === 0) return true;
  return state.provinces.some((p) => p.owner === playerId && !giving.includes(p.id));
}

/** Moves a bundle from one player to another (mutates the private copy given by the caller). */
function transfer(state: GameState, from: PlayerId, to: PlayerId, bundle: Bundle, tick: number): void {
  const giver = state.players.find((p) => p.id === from);
  const taker = state.players.find((p) => p.id === to);
  if (!giver || !taker) return;
  for (const [resource, amount] of Object.entries(bundle.resources)) {
    giver.stockpile[resource] = (giver.stockpile[resource] ?? 0) - amount;
    taker.stockpile[resource] = (taker.stockpile[resource] ?? 0) + amount;
  }
  for (const id of bundle.provinces) {
    const province = state.provinces.find((p) => p.id === id);
    if (!province) continue;
    province.owner = to;
    state.events.push({ tick, type: 'province_transferred', provinceId: id, from, to });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Trade offers waiting for an answer from this player. */
export function tradesFor(state: GameState, playerId: PlayerId): Trade[] {
  return state.trades.filter((t) => t.to === playerId);
}

/** Trade offers this player made and that are still open. */
export function tradesFrom(state: GameState, playerId: PlayerId): Trade[] {
  return state.trades.filter((t) => t.from === playerId);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type TradeError =
  | 'game_over'
  | 'player_not_found'
  | 'same_player'
  | 'player_eliminated'
  | 'unknown_resource'
  | 'invalid_amount'
  | 'province_not_found'
  | 'empty_trade'
  | 'insufficient_resources'
  | 'partner_insufficient'
  | 'not_province_owner'
  | 'last_province'
  | 'too_many_trades'
  | 'trade_not_found'
  | 'not_recipient'
  | 'not_sender';

export type TradeResult = { ok: true; state: GameState } | { ok: false; error: TradeError };

function orderTick(state: GameState): number {
  return state.tick + 1;
}

/** The checks both a gift and a trade offer start with. */
function checkParties(state: GameState, from: PlayerId, to: PlayerId): TradeError | null {
  if (state.outcome) return 'game_over';
  if (!state.players.some((p) => p.id === from) || !state.players.some((p) => p.id === to)) return 'player_not_found';
  if (from === to) return 'same_player';
  if (state.eliminated.includes(from) || state.eliminated.includes(to)) return 'player_eliminated';
  return null;
}

/**
 * Offers a deal: the player gives `give` and asks `to` for `want`. The giver must have what is
 * offered now; what is asked is only checked when the other side answers.
 */
export function orderOfferTrade(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  to: PlayerId,
  give: Bundle,
  want: Bundle,
): TradeResult {
  const parties = checkParties(state, playerId, to);
  if (parties) return { ok: false, error: parties };
  const problem = bundleProblem(state, rules, give) ?? bundleProblem(state, rules, want);
  if (problem) return { ok: false, error: problem };
  const offered = normalizedBundle(give);
  const asked = normalizedBundle(want);
  if (isEmptyBundle(offered) && isEmptyBundle(asked)) return { ok: false, error: 'empty_trade' };
  if (!ownsProvinces(state, playerId, offered.provinces) || !ownsProvinces(state, to, asked.provinces)) {
    return { ok: false, error: 'not_province_owner' };
  }
  if (!keepsAProvince(state, playerId, offered.provinces)) return { ok: false, error: 'last_province' };
  if (!hasResources(state, playerId, offered)) return { ok: false, error: 'insufficient_resources' };
  if (state.trades.filter((t) => t.from === playerId).length >= chatRules(rules).maxOpenTrades) {
    return { ok: false, error: 'too_many_trades' };
  }

  const next = structuredClone(state);
  const trade: Trade = {
    id: `trade-${next.nextId}`,
    from: playerId,
    to,
    give: offered,
    want: asked,
    expiresAt: next.tick + rules.diplomacy.proposalTicks,
  };
  next.nextId += 1;
  next.trades.push(trade);
  next.events.push({ tick: orderTick(next), type: 'trade_offered', tradeId: trade.id, from: playerId, to });
  postDirect(next, playerId, to, playerId, { kind: 'trade', tradeId: trade.id, give: offered, want: asked, status: 'open' }, rules);
  return { ok: true, state: next };
}

/**
 * Answers a trade offered to the player. Accepting needs both sides to still have what they
 * promised; rejecting withdraws the offer. Either way the offer is closed.
 */
export function orderRespondTrade(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  tradeId: string,
  accept: boolean,
): TradeResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade) return { ok: false, error: 'trade_not_found' };
  if (trade.to !== playerId) return { ok: false, error: 'not_recipient' };
  const { from, to } = trade;

  if (accept) {
    if (state.eliminated.includes(from) || state.eliminated.includes(to)) return { ok: false, error: 'player_eliminated' };
    if (!ownsProvinces(state, from, trade.give.provinces) || !ownsProvinces(state, to, trade.want.provinces)) {
      return { ok: false, error: 'not_province_owner' };
    }
    if (!hasResources(state, from, trade.give)) return { ok: false, error: 'partner_insufficient' };
    if (!hasResources(state, to, trade.want)) return { ok: false, error: 'insufficient_resources' };
    // Provinces moving both ways at once: each side must keep one after the swap.
    const left = (id: PlayerId, out: ProvinceId[], incoming: ProvinceId[]) =>
      state.provinces.some((p) => (p.owner === id && !out.includes(p.id)) || incoming.includes(p.id));
    if (!left(from, trade.give.provinces, trade.want.provinces) || !left(to, trade.want.provinces, trade.give.provinces)) {
      return { ok: false, error: 'last_province' };
    }
  }

  const next = structuredClone(state);
  next.trades = next.trades.filter((t) => t.id !== tradeId);
  const tick = orderTick(next);
  if (accept) {
    transfer(next, from, to, trade.give, tick);
    transfer(next, to, from, trade.want, tick);
    setOfferStatus(next, tradeId, 'accepted');
    next.events.push({ tick, type: 'trade_accepted', tradeId, from, to });
  } else {
    setOfferStatus(next, tradeId, 'rejected');
    next.events.push({ tick, type: 'trade_rejected', tradeId, from, to });
  }
  return { ok: true, state: next };
}

/** Withdraws an offer the player made. */
export function orderCancelTrade(state: GameState, playerId: PlayerId, tradeId: string): TradeResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade) return { ok: false, error: 'trade_not_found' };
  if (trade.from !== playerId) return { ok: false, error: 'not_sender' };
  const next = structuredClone(state);
  next.trades = next.trades.filter((t) => t.id !== tradeId);
  setOfferStatus(next, tradeId, 'cancelled');
  next.events.push({ tick: orderTick(next), type: 'trade_cancelled', tradeId, from: trade.from, to: trade.to });
  return { ok: true, state: next };
}

/** Gives resources, money or provinces to another player. It is delivered at once: nothing to answer. */
export function orderGift(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  to: PlayerId,
  give: Bundle,
): TradeResult {
  const parties = checkParties(state, playerId, to);
  if (parties) return { ok: false, error: parties };
  const problem = bundleProblem(state, rules, give);
  if (problem) return { ok: false, error: problem };
  const gift = normalizedBundle(give);
  if (isEmptyBundle(gift)) return { ok: false, error: 'empty_trade' };
  if (!ownsProvinces(state, playerId, gift.provinces)) return { ok: false, error: 'not_province_owner' };
  if (!keepsAProvince(state, playerId, gift.provinces)) return { ok: false, error: 'last_province' };
  if (!hasResources(state, playerId, gift)) return { ok: false, error: 'insufficient_resources' };

  const next = structuredClone(state);
  const tick = orderTick(next);
  transfer(next, playerId, to, gift, tick);
  next.events.push({ tick, type: 'gift_sent', from: playerId, to, give: gift });
  postDirect(next, playerId, to, playerId, { kind: 'gift', give: gift }, rules);
  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Closes the offers that ran out of time and those of players who left the game (a phase of `tick()`). */
export function processTrades(state: GameState): void {
  const open: Trade[] = [];
  for (const trade of state.trades) {
    if (state.eliminated.includes(trade.from) || state.eliminated.includes(trade.to)) {
      setOfferStatus(state, trade.id, 'cancelled');
      continue;
    }
    if (state.tick >= trade.expiresAt) {
      setOfferStatus(state, trade.id, 'expired');
      state.events.push({ tick: state.tick, type: 'trade_expired', tradeId: trade.id, from: trade.from, to: trade.to });
      continue;
    }
    open.push(trade);
  }
  state.trades = open;
}
