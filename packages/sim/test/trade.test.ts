import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  currencyOf,
  duelMap,
  findDirectChat,
  orderCancelTrade,
  orderGift,
  orderOfferTrade,
  orderRespondTrade,
  provinceMoneyIncome,
  runAi,
  tick,
  tradesFor,
  viewFor,
  type Bundle,
  type GameState,
  type Ruleset,
} from '../src';

const rules: Ruleset = baseRuleset;
const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
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
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    stockpiles: { red: { money: 5000, grain: 8000 }, blue: { money: 1000, iron: 6000 } },
  });
}

const bundle = (resources: Record<string, number> = {}, provinces: string[] = []): Bundle => ({ resources, provinces });

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function stock(state: GameState, player: string, resource: string): number {
  return state.players.find((p) => p.id === player)?.stockpile[resource] ?? 0;
}

describe('money', () => {
  it('is a resource, earned by every owned land province scaled by morale', () => {
    expect(currencyOf(rules)).toBe('money');
    const province = game().provinces.find((p) => p.id === 'rcap')!;
    expect(provinceMoneyIncome(rules, province)).toBe(1000);
    expect(provinceMoneyIncome(rules, { ...province, morale: 0 })).toBe(1000 * rules.morale.minProductionFactor);
    expect(provinceMoneyIncome({ ...rules, economy: undefined }, province)).toBe(0);
    expect(provinceMoneyIncome(rules, { ...province, owner: null })).toBe(0);
  });
});

describe('gifts', () => {
  it('deliver money and goods at once and tell it in the chat', () => {
    const state = must(orderGift(game(), rules, 'red', 'blue', bundle({ money: 2000, grain: 3000 }))).state;
    expect(stock(state, 'red', 'money')).toBe(3000);
    expect(stock(state, 'blue', 'money')).toBe(3000);
    expect(stock(state, 'blue', 'grain')).toBe(3000);
    expect(findDirectChat(state, 'red', 'blue')!.messages.at(-1)).toMatchObject({ from: 'red', content: { kind: 'gift' } });
    expect(state.events.some((e) => e.type === 'gift_sent')).toBe(true);
  });

  it('give provinces, but never the last one', () => {
    let state = must(orderGift(game(), rules, 'red', 'blue', bundle({}, ['rfront']))).state;
    expect(state.provinces.find((p) => p.id === 'rfront')!.owner).toBe('blue');
    expect(state.events.some((e) => e.type === 'province_transferred')).toBe(true);
    const lone = { ...game(), provinces: game().provinces.map((p) => (p.owner === 'red' && p.id !== 'rcap' ? { ...p, owner: null } : p)) };
    expect(orderGift(lone, rules, 'red', 'blue', bundle({}, ['rcap']))).toEqual({ ok: false, error: 'last_province' });
    state = game();
    expect(orderGift(state, rules, 'red', 'blue', bundle({}, ['bcap']))).toEqual({ ok: false, error: 'not_province_owner' });
  });

  it('refuse what cannot be given', () => {
    const state = game();
    expect(orderGift(state, rules, 'red', 'blue', bundle({ money: 9999 }))).toEqual({ ok: false, error: 'insufficient_resources' });
    expect(orderGift(state, rules, 'red', 'blue', bundle())).toEqual({ ok: false, error: 'empty_trade' });
    expect(orderGift(state, rules, 'red', 'blue', bundle({ gold: 1 }))).toEqual({ ok: false, error: 'unknown_resource' });
    expect(orderGift(state, rules, 'red', 'blue', bundle({ money: -5 }))).toEqual({ ok: false, error: 'invalid_amount' });
    expect(orderGift(state, rules, 'red', 'red', bundle({ money: 5 }))).toEqual({ ok: false, error: 'same_player' });
  });
});

describe('trades', () => {
  it('swap what both sides promised when accepted, and show the card as accepted', () => {
    let state = must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 4000 }), bundle({ iron: 2000, money: 500 }))).state;
    expect(tradesFor(state, 'blue')).toHaveLength(1);
    const card = () => findDirectChat(state, 'red', 'blue')!.messages.at(-1)!.content;
    expect(card()).toMatchObject({ kind: 'trade', status: 'open', give: { resources: { grain: 4000 } } });

    state = must(orderRespondTrade(state, rules, 'blue', state.trades[0]!.id, true)).state;
    expect(state.trades).toEqual([]);
    expect(stock(state, 'red', 'grain')).toBe(4000);
    expect(stock(state, 'red', 'iron')).toBe(2000);
    expect(stock(state, 'red', 'money')).toBe(5500);
    expect(stock(state, 'blue', 'grain')).toBe(4000);
    expect(stock(state, 'blue', 'money')).toBe(500);
    expect(card()).toMatchObject({ status: 'accepted' });
  });

  it('can swap provinces for money', () => {
    let state = must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({}, ['rfront']), bundle({ money: 1000 }))).state;
    state = must(orderRespondTrade(state, rules, 'blue', state.trades[0]!.id, true)).state;
    expect(state.provinces.find((p) => p.id === 'rfront')!.owner).toBe('blue');
    expect(stock(state, 'red', 'money')).toBe(6000);
  });

  it('is rejected, cancelled or expires without moving anything', () => {
    const offer = () => must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 100 }), bundle({ iron: 100 }))).state;
    let state = offer();
    state = must(orderRespondTrade(state, rules, 'blue', state.trades[0]!.id, false)).state;
    expect(findDirectChat(state, 'red', 'blue')!.messages.at(-1)!.content).toMatchObject({ status: 'rejected' });
    expect(stock(state, 'red', 'grain')).toBe(8000);

    state = offer();
    state = must(orderCancelTrade(state, 'red', state.trades[0]!.id)).state;
    expect(findDirectChat(state, 'red', 'blue')!.messages.at(-1)!.content).toMatchObject({ status: 'cancelled' });

    state = offer();
    for (let i = 0; i < rules.diplomacy.proposalTicks; i++) state = tick(state, rules);
    expect(state.trades).toEqual([]);
    expect(findDirectChat(state, 'red', 'blue')!.messages[0]!.content).toMatchObject({ status: 'expired' });
  });

  it('checks both sides again when answered', () => {
    const state = must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 4000 }), bundle({ iron: 2000 }))).state;
    const id = state.trades[0]!.id;
    const redBroke = { ...state, players: state.players.map((p) => (p.id === 'red' ? { ...p, stockpile: { ...p.stockpile, grain: 0 } } : p)) };
    expect(orderRespondTrade(redBroke, rules, 'blue', id, true)).toEqual({ ok: false, error: 'partner_insufficient' });
    const blueBroke = { ...state, players: state.players.map((p) => (p.id === 'blue' ? { ...p, stockpile: { ...p.stockpile, iron: 0 } } : p)) };
    expect(orderRespondTrade(blueBroke, rules, 'blue', id, true)).toEqual({ ok: false, error: 'insufficient_resources' });
    expect(orderRespondTrade(state, rules, 'red', id, true)).toEqual({ ok: false, error: 'not_recipient' });
    expect(orderCancelTrade(state, 'blue', id)).toEqual({ ok: false, error: 'not_sender' });
    expect(orderRespondTrade(state, rules, 'blue', 'trade-999', true)).toEqual({ ok: false, error: 'trade_not_found' });
  });

  it('are limited per player and need something to trade', () => {
    let state = game();
    expect(orderOfferTrade(state, rules, 'red', 'blue', bundle(), bundle())).toEqual({ ok: false, error: 'empty_trade' });
    expect(orderOfferTrade(state, rules, 'red', 'blue', bundle({ grain: 99999 }), bundle())).toEqual({ ok: false, error: 'insufficient_resources' });
    for (let i = 0; i < rules.chat!.maxOpenTrades; i++) state = must(orderOfferTrade(state, rules, 'red', 'blue', bundle({ grain: 10 }), bundle())).state;
    expect(orderOfferTrade(state, rules, 'red', 'blue', bundle({ grain: 10 }), bundle())).toEqual({ ok: false, error: 'too_many_trades' });
  });

  it('are private: a third player does not see the offer or its events', () => {
    const state = must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 100 }), bundle())).state;
    const green = viewFor(state, rules, 'green').state;
    expect(green.trades).toEqual([]);
    expect(green.events.some((e) => e.type === 'trade_offered')).toBe(false);
    expect(viewFor(state, rules, 'blue').state.trades).toHaveLength(1);
  });
});

describe('the AI and trades', () => {
  const options = { airForce: false, navy: false, spies: false, market: false, maxEconomyBuildings: 0, maxInfantryBatch: 0, maxArtilleryBatch: 0 };
  // The two sides have to be at peace for the AI to deal.
  const atPeace = (state: GameState): GameState => ({ ...state, relations: [{ a: 'blue', b: 'red', kind: 'truce', until: 999 }] });

  it('accepts a fair deal and turns down an unfair one or one that costs it a province', () => {
    let state = atPeace(must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 4000 }), bundle({ iron: 2000 }))).state);
    state = runAi(state, rules, 'blue', options);
    expect(state.trades).toEqual([]);
    expect(stock(state, 'blue', 'grain')).toBe(4000);

    let unfair = atPeace(must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 100 }), bundle({ iron: 5000 }))).state);
    unfair = runAi(unfair, rules, 'blue', options);
    expect(unfair.trades).toEqual([]);
    expect(stock(unfair, 'blue', 'iron')).toBe(6000);

    let land = atPeace(must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ money: 5000 }), bundle({}, ['bfront']))).state);
    land = runAi(land, rules, 'blue', options);
    expect(land.provinces.find((p) => p.id === 'bfront')!.owner).toBe('blue');
  });

  it('does not deal with somebody it is at war with', () => {
    let state = must(orderOfferTrade(game(), rules, 'red', 'blue', bundle({ grain: 4000 }), bundle({ iron: 100 }))).state;
    state = runAi(state, rules, 'blue', options);
    expect(state.trades).toEqual([]);
    expect(stock(state, 'blue', 'grain')).toBe(0);
  });
});
