import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  defaultAiOptions,
  duelMap,
  orderMarketOffer,
  runAi,
  tick,
  type GameState,
  type Ruleset,
} from '../src';

// These tests are about bartering goods: a game without money keeps the stockpiles to four resources.
import { withOffices } from './helpers';

const rules: Ruleset = { ...baseRuleset, resources: baseRuleset.resources.filter((r) => r !== 'money'), economy: undefined };
const market = rules.market!;

const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
};

/** Blue is the AI under test; its stockpile is set by each test. Red is the other side of the market. */
function game(blue: Record<string, number>, red: Record<string, number> = {}, ruleset: Ruleset = rules): GameState {
  return withOffices(createGame({
    map: duelMap,
    rules: ruleset,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
    ],
    owners,
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    stockpiles: { red: { wood: 0, iron: 0, grain: 0, coal: 0, ...red }, blue: { wood: 0, iron: 0, grain: 0, coal: 0, ...blue } },
  }));
}

/** The AI plays only the market (a tick that is a multiple of the interval, so it visits it). */
const options = { airForce: false, navy: false, spies: false, maxEconomyBuildings: 0 };

function atMarketTick(state: GameState): GameState {
  return { ...state, tick: defaultAiOptions.marketInterval };
}

function stock(state: GameState, player: string, resource: string): number {
  return state.players.find((p) => p.id === player)?.stockpile[resource] ?? 0;
}

describe('AI on the market', () => {
  it('offers part of its surplus for what it lacks', () => {
    // Average 12500: grain is far above it, iron and coal far below.
    const state = atMarketTick(game({ grain: 40000, wood: 10000, iron: 0, coal: 0 }));
    const next = runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 });
    expect(next.market).toHaveLength(1);
    const order = next.market[0]!;
    expect(order.owner).toBe('blue');
    expect(order.give.resource).toBe('grain');
    expect(['iron', 'coal']).toContain(order.want.resource);
    expect(order.give.amount).toBe(Math.floor((40000 - 12500) / 2));
    expect(order.want.amount).toBeCloseTo(order.give.amount * defaultAiOptions.marketAskRate);
    expect(stock(next, 'blue', 'grain')).toBe(40000 - order.give.amount);
  });

  it('does nothing when nothing is in surplus or short, or between visits', () => {
    const even = atMarketTick(game({ grain: 10000, wood: 10000, iron: 10000, coal: 10000 }));
    expect(runAi(even, rules, 'blue', { ...options, maxInfantryBatch: 0 }).market).toEqual([]);
    const lopsided = game({ grain: 40000 });
    const notNow: GameState = { ...lopsided, tick: defaultAiOptions.marketInterval + 1 };
    expect(runAi(notNow, rules, 'blue', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 }).market).toEqual([]);
  });

  it('can be switched off, and does not trade in a game without a market', () => {
    const state = atMarketTick(game({ grain: 40000 }));
    expect(runAi(state, rules, 'blue', { ...options, market: false, maxInfantryBatch: 0 }).market).toEqual([]);
    const noMarket: Ruleset = { ...rules, id: 'no-market', market: undefined };
    const plain = atMarketTick(game({ grain: 40000 }, {}, noMarket));
    expect(runAi(plain, noMarket, 'blue', { ...options, maxInfantryBatch: 0 }).market).toEqual([]);
  });

  it('does not repeat an offer that is still open', () => {
    let state = atMarketTick(game({ grain: 90000, wood: 10000 }));
    state = runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0 });
    const first = state.market.length;
    expect(first).toBe(1);
    state = { ...state, tick: defaultAiOptions.marketInterval * 2 };
    expect(runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0 }).market).toHaveLength(first);
  });

  it('takes a fair offer that gives what it lacks for what it can spare', () => {
    // Red offers 3000 iron for 3000 grain: an even swap.
    // Average 15000: grain is the surplus and iron (0) the only shortage.
    let state = atMarketTick(game({ grain: 40000, wood: 10000, coal: 10000 }, { iron: 5000 }));
    const placed = orderMarketOffer(state, rules, 'red', 'iron', 3000, 'grain', 3000);
    if (!placed.ok) throw new Error(placed.error);
    state = placed.state;
    const next = runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 });
    expect(next.market).toEqual([]);
    expect(stock(next, 'blue', 'iron')).toBe(3000);
    expect(stock(next, 'blue', 'grain')).toBe(37000);
    expect(stock(next, 'red', 'grain')).toBe(3000);
  });

  it('turns down an offer that is not fair to it, and then makes its own', () => {
    // Red asks 3000 grain for 1000 iron: the AI would get a third of what it gives.
    let state = atMarketTick(game({ grain: 40000, wood: 10000, coal: 10000 }, { iron: 5000 }));
    const placed = orderMarketOffer(state, rules, 'red', 'iron', 1000, 'grain', 3000);
    if (!placed.ok) throw new Error(placed.error);
    state = placed.state;
    const next = runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 });
    expect(stock(next, 'blue', 'iron')).toBe(0);
    const own = next.market.filter((o) => o.owner === 'blue');
    expect(own).toHaveLength(1);
    expect(own[0]?.want.resource).toBe('iron');
    expect(next.market.find((o) => o.owner === 'red')).toBeDefined();
  });

  it('never offers less than the minimum, and never touches what it needs more than the average', () => {
    const state = atMarketTick(game({ grain: 3000, wood: 0, iron: 0, coal: 0 }));
    // spare = (3000 - 750) / 2 = 1125 > 500: offers. With less grain the spare is below the minimum.
    expect(runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0 }).market).toHaveLength(1);
    const tiny = atMarketTick(game({ grain: 1000, wood: 0, iron: 0, coal: 0 }));
    expect((market.minAmount ?? 0) > (1000 - 250) / 2).toBe(true);
    expect(runAi(tiny, rules, 'blue', { ...options, maxInfantryBatch: 0 }).market).toEqual([]);
  });

  it('keeps the game going: two AIs on a market play a whole match without breaking the books', () => {
    // Blue has grain and lacks iron; red is the other way round.
    let state = game({ grain: 30000, iron: 0, wood: 10000, coal: 10000 }, { iron: 30000, grain: 0, wood: 10000, coal: 10000 });
    const before = Object.fromEntries(rules.resources.map((r) => [r, total(state, r)]));
    let trades = 0;
    for (let i = 0; i < 80 && !state.outcome; i++) {
      state = runAi(state, rules, 'red', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 });
      state = runAi(state, rules, 'blue', { ...options, maxInfantryBatch: 0, maxArtilleryBatch: 0 });
      state = tick(state, rules);
      trades += state.events.filter((e) => e.type === 'market_trade').length;
      for (const p of state.players) for (const r of rules.resources) expect(stock(state, p.id, r)).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(trades).toBeGreaterThan(0); // red lacks grain, blue lacks iron: they find each other
    // Production adds resources, so only check that nothing was destroyed: totals never fall.
    for (const r of rules.resources) expect(total(state, r)).toBeGreaterThanOrEqual(before[r]! - 1e-6);
  });
});

function total(state: GameState, resource: string): number {
  const held = state.market.filter((o) => o.give.resource === resource).reduce((s, o) => s + o.give.amount, 0);
  return state.players.reduce((s, p) => s + (p.stockpile[resource] ?? 0), 0) + held;
}
