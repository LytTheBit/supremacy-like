import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  canRecruitAt,
  createGame,
  moraleProductionFactor,
  orderMove,
  orderRecruit,
  runAi,
  tick,
  tinyMap,
  type GameState,
  type Ruleset,
} from '../src';

import { withOffices } from './helpers';

const rules = baseRuleset;

const players = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

// Domination needs all provinces here, so these tests only measure morale.
const noVictory: Ruleset = { ...rules, victory: { provinceShare: 1 } };

function withStockpile(state: GameState, playerId: string, stock: Record<string, number>): GameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.id === playerId);
  if (!player) throw new Error('player not found');
  player.stockpile = { wood: 0, iron: 0, grain: 0, coal: 0, ...stock };
  return next;
}

function setMorale(state: GameState, provinceId: string, morale: number): GameState {
  const next = structuredClone(state);
  const province = next.provinces.find((p) => p.id === provinceId);
  if (!province) throw new Error('province not found');
  province.morale = morale;
  return next;
}

function moraleOf(state: GameState, provinceId: string): number {
  return state.provinces.find((p) => p.id === provinceId)?.morale ?? -1;
}

function run(state: GameState, ticks: number, ruleset: Ruleset = noVictory): GameState {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, ruleset);
  return current;
}

function game(extra: Partial<Parameters<typeof createGame>[0]> = {}, ruleset: Ruleset = noVictory): GameState {
  return withOffices(
    createGame({
      map: tinyMap,
      rules: ruleset,
      players,
      owners: { redhaven: 'red', westmark: 'red', eastmark: 'blue', bluehaven: 'blue' },
      armies: [],
      ...extra,
    }),
  );
}

describe('province morale', () => {
  it('starts at the ruleset value', () => {
    const state = game();
    expect(state.provinces.every((p) => p.morale === 100)).toBe(true);

    const custom = game({}, { ...noVictory, morale: { ...rules.morale, start: 60 } });
    expect(custom.provinces.every((p) => p.morale === 60)).toBe(true);
  });

  it('is regained every tick by owned provinces, up to 100', () => {
    let state = setMorale(game(), 'redhaven', 90);
    state = setMorale(state, 'midfield', 10); // neutral: does not recover

    state = run(state, 1);
    expect(moraleOf(state, 'redhaven')).toBe(92);
    expect(moraleOf(state, 'midfield')).toBe(10);

    state = run(state, 10);
    expect(moraleOf(state, 'redhaven')).toBe(100);
  });

  it('drops when a province is conquered', () => {
    const start = game({ armies: [{ id: 'r1', owner: 'red', location: 'westmark', units: { infantry: 20 } }] });
    const ordered = orderMove(start, 'red', 'r1', 'midfield');
    if (!ordered.ok) throw new Error('order failed');

    // Midfield is neutral: red walks in and conquers it (2 ticks of travel).
    const state = run(ordered.state, 2);
    expect(state.provinces.find((p) => p.id === 'midfield')?.owner).toBe('red');
    expect(moraleOf(state, 'midfield')).toBe(rules.morale.afterConquest);

    // Then it recovers.
    expect(moraleOf(run(state, 5), 'midfield')).toBe(rules.morale.afterConquest + 5 * rules.morale.recoveryPerTick);
  });

  it('scales production between the minimum factor and 1', () => {
    const state = game();
    const province = state.provinces.find((p) => p.id === 'redhaven');
    if (!province) throw new Error('province not found');

    expect(moraleProductionFactor(rules, { ...province, morale: 100 })).toBe(1);
    expect(moraleProductionFactor(rules, { ...province, morale: 0 })).toBe(rules.morale.minProductionFactor);
    expect(moraleProductionFactor(rules, { ...province, morale: 50 })).toBeCloseTo(0.625, 10);
  });

  it('reduces the resources a province produces', () => {
    const grain = (state: GameState) => state.players.find((p) => p.id === 'red')?.stockpile.grain ?? 0;
    const normal = run(game(), 1);
    // Morale 50 recovers by 2 before production: 52 -> factor 0.25 + 0.75 * 0.52.
    const shaken = run(setMorale(game(), 'redhaven', 50), 1);

    expect(grain(normal)).toBe(3000);
    expect(grain(shaken)).toBeCloseTo(3000 * (0.25 + 0.75 * 0.52), 6);
  });

  it('blocks recruitment below the minimum morale', () => {
    const rich = withStockpile(game(), 'red', { grain: 20000, iron: 10000 });
    const shaken = setMorale(rich, 'redhaven', rules.morale.minToRecruit - 1);

    expect(orderRecruit(shaken, noVictory, 'red', 'redhaven', 'infantry', 1)).toEqual({
      ok: false,
      error: 'low_morale',
    });
    // Another province with enough morale is fine, and so is exactly the minimum.
    expect(orderRecruit(shaken, noVictory, 'red', 'westmark', 'infantry', 1).ok).toBe(true);
    const exact = setMorale(rich, 'redhaven', rules.morale.minToRecruit);
    expect(orderRecruit(exact, noVictory, 'red', 'redhaven', 'infantry', 1).ok).toBe(true);

    const redhaven = shaken.provinces.find((p) => p.id === 'redhaven');
    if (!redhaven) throw new Error('province not found');
    expect(canRecruitAt(rules, redhaven)).toBe(false);
  });

  it('lets a shaken province recover until it can recruit again', () => {
    const rich = withStockpile(setMorale(game(), 'redhaven', 40), 'red', { grain: 99000, iron: 99000 });
    expect(orderRecruit(rich, noVictory, 'red', 'redhaven', 'infantry', 1).ok).toBe(false);

    // 40 -> 50 takes 5 ticks at +2 per tick.
    const later = run(rich, 5);
    expect(moraleOf(later, 'redhaven')).toBe(50);
    expect(orderRecruit(later, noVictory, 'red', 'redhaven', 'infantry', 1).ok).toBe(true);
  });

  it('keeps the AI from recruiting in provinces with low morale', () => {
    // Red owns only redhaven (shaken) and westmark: the AI must use westmark.
    const state = withStockpile(
      setMorale(
        game({ owners: { redhaven: 'red', westmark: 'red', bluehaven: 'blue' } }),
        'redhaven',
        10,
      ),
      'red',
      { grain: 20000, iron: 10000 },
    );
    const next = runAi(state, noVictory, 'red');
    expect(next.recruitQueue.length).toBeGreaterThan(0);
    expect(next.recruitQueue.every((job) => job.provinceId !== 'redhaven')).toBe(true);
  });

  it('is validated when the game is created', () => {
    const make = (morale: Partial<typeof rules.morale>) => () =>
      game({}, { ...noVictory, morale: { ...rules.morale, ...morale } });

    expect(make({ start: 120 })).toThrow(/morale.start/);
    expect(make({ afterConquest: -1 })).toThrow(/morale.afterConquest/);
    expect(make({ minToRecruit: 101 })).toThrow(/morale.minToRecruit/);
    expect(make({ minProductionFactor: 1.5 })).toThrow(/minProductionFactor/);
    expect(make({ recoveryPerTick: -1 })).toThrow(/recoveryPerTick/);
    expect(make({})).not.toThrow();
  });

  it('is deterministic and does not modify the input state', () => {
    const state = setMorale(game(), 'redhaven', 30);
    const snapshot = JSON.stringify(state);
    const a = run(state, 6);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(run(state, 6)).toEqual(a);
  });
});
