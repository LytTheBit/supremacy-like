import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  createGame,
  createSkirmish,
  findPath,
  generateHexMap,
  hexMapBounds,
  hexToPixel,
  runMatch,
  tinyMap,
  toMapDef,
} from '../src';

const rules = baseRuleset;
const hexMap = generateHexMap({ width: 44, height: 30, provinceCount: 24, seed: 5 });
const mapDef = toMapDef(hexMap);

const two = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
];

describe('createSkirmish', () => {
  const state = createSkirmish(hexMap, mapDef, rules, { players: two });

  it('gives each player the requested number of provinces and a capital army', () => {
    for (const player of two) {
      expect(state.provinces.filter((p) => p.owner === player.id)).toHaveLength(3);
      const army = state.armies.find((a) => a.owner === player.id);
      expect(army?.units).toEqual({ infantry: 10 });
    }
    expect(state.provinces.filter((p) => p.owner === null).length).toBe(mapDef.provinces.length - 6);
  });

  it('puts the capitals far apart', () => {
    const [a, b] = state.armies.map((army) => army.location);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const between = findPath(mapDef.edges, a ?? '', b ?? '')?.distance ?? 0;

    // Farther than the average distance between two provinces of the map.
    const ids = mapDef.provinces.map((p) => p.id);
    let total = 0;
    let pairs = 0;
    for (const x of ids) {
      for (const y of ids) {
        if (x < y) {
          total += findPath(mapDef.edges, x, y)?.distance ?? 0;
          pairs += 1;
        }
      }
    }
    expect(between).toBeGreaterThan(total / pairs);
  });

  it('gives starting provinces that are close to the capital', () => {
    for (const player of two) {
      const capital = state.armies.find((a) => a.owner === player.id)?.location ?? '';
      for (const province of state.provinces.filter((p) => p.owner === player.id)) {
        const d = findPath(mapDef.edges, capital, province.id)?.distance ?? Infinity;
        expect(d).toBeLessThan(10);
      }
    }
  });

  it('starts with resources for everyone', () => {
    for (const player of state.players) {
      expect(player.stockpile).toEqual({ money: 15000, wood: 15000, iron: 15000, grain: 15000, coal: 15000 });
    }
  });

  it('is deterministic', () => {
    expect(createSkirmish(hexMap, mapDef, rules, { players: two })).toEqual(state);
  });

  it('supports custom troops, stock, buildings and more players', () => {
    const custom = createSkirmish(hexMap, mapDef, rules, {
      players: [...two, { id: 'green', name: 'Green' }],
      provincesPerPlayer: 2,
      startingTroops: { infantry: 5, artillery: 2 },
      startingStock: { wood: 1000, iron: 2000 },
      startingBuildings: ['barracks'],
    });

    expect(new Set(custom.armies.map((a) => a.location)).size).toBe(3);
    expect(custom.provinces.filter((p) => p.owner === 'green')).toHaveLength(2);
    expect(custom.armies[0]?.units).toEqual({ infantry: 5, artillery: 2 });
    expect(custom.players[0]?.stockpile).toMatchObject({ wood: 1000, iron: 2000, grain: 0, coal: 0 });
    for (const army of custom.armies) {
      expect(custom.provinces.find((p) => p.id === army.location)?.buildings).toEqual(['recruitment_office', 'barracks']);
    }
  });

  it('gives every starting province the ruleset starting buildings', () => {
    for (const province of state.provinces.filter((p) => p.owner !== null)) {
      expect(province.buildings).toContain('recruitment_office');
    }
    expect(state.provinces.filter((p) => p.owner === null).every((p) => p.buildings.length === 0)).toBe(true);
  });

  it('rejects impossible setups', () => {
    expect(() => createSkirmish(hexMap, mapDef, rules, { players: [{ id: 'solo', name: 'Solo' }] })).toThrow(
      /at least two players/,
    );
    expect(() => createSkirmish(hexMap, mapDef, rules, { players: two, provincesPerPlayer: 99 })).toThrow(
      /Not enough provinces/,
    );
    expect(() =>
      createSkirmish(hexMap, mapDef, rules, { players: two, startingBuildings: ['castle'] }),
    ).toThrow(/Unknown building/);
  });

  it('can be played by the AI', () => {
    const final = runMatch(state, rules, { aiPlayers: ['red', 'blue'], maxTicks: 60 });
    expect(final.tick).toBeGreaterThan(0);
    expect(final.provinces.filter((p) => p.owner !== null).length).toBeGreaterThanOrEqual(6);
  });
});

describe('createGame stockpiles', () => {
  const make = (stockpiles: Record<string, Record<string, number>>) => () =>
    createGame({ map: tinyMap, rules, players: two, owners: {}, armies: [], stockpiles });

  it('applies starting resources and validates them', () => {
    const game = createGame({
      map: tinyMap,
      rules,
      players: two,
      owners: {},
      armies: [],
      stockpiles: { red: { wood: 500 } },
    });
    expect(game.players[0]?.stockpile).toEqual({ money: 0, wood: 500, iron: 0, grain: 0, coal: 0 });
    expect(game.players[1]?.stockpile).toEqual({ money: 0, wood: 0, iron: 0, grain: 0, coal: 0 });

    expect(make({ ghost: { wood: 1 } })).toThrow(/unknown player/);
    expect(make({ red: { gold: 1 } })).toThrow(/unknown resource/);
    expect(make({ red: { wood: -5 } })).toThrow(/negative/);
  });
});

describe('hexMapBounds', () => {
  it('contains every hex with the given margin', () => {
    const size = 12;
    const bounds = hexMapBounds(hexMap, size, 5);
    for (const cell of hexMap.cells) {
      const p = hexToPixel(cell, size);
      expect(p.x - 10).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x + 10).toBeLessThanOrEqual(bounds.maxX);
      expect(p.y - size).toBeGreaterThanOrEqual(bounds.minY);
      expect(p.y + size).toBeLessThanOrEqual(bounds.maxY);
    }
    expect(bounds.width).toBeCloseTo(bounds.maxX - bounds.minX, 9);
    expect(hexMapBounds(hexMap, size, 5).width).toBeGreaterThan(hexMapBounds(hexMap, size, 0).width);
  });

  it('handles an empty map', () => {
    expect(hexMapBounds({ id: 'e', cells: [], provinces: [], links: [] })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    });
  });
});
