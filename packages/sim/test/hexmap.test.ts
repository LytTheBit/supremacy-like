import { describe, expect, it } from 'vitest';
import {
  HEX_DIRECTIONS,
  SQRT3,
  adjacentProvincePairs,
  baseRuleset,
  connectedGroups,
  createGame,
  extractBorders,
  fbm,
  findBridgeLinks,
  findPath,
  generateHexMap,
  hash2,
  hexCorners,
  hexDistance,
  hexKey,
  hexNeighbors,
  hexToPixel,
  mulberry32,
  pixelToHex,
  provinceAnchors,
  renderSvg,
  runMatch,
  toMapDef,
  validateHexMap,
  valueNoise,
  type HexCell,
  type HexMapData,
} from '../src';

/** Builds a tiny hand-made map. `land` maps a province id to its cells as [q, r] pairs. */
function handMap(land: Record<string, [number, number][]>, extra: Partial<HexMapData> = {}): HexMapData {
  const cells: HexCell[] = [];
  for (const [province, list] of Object.entries(land)) {
    for (const [q, r] of list) cells.push({ q, r, kind: 'land', province });
  }
  return {
    id: 'hand',
    cells,
    provinces: Object.keys(land).map((id) => ({ id, name: id, resource: 'grain', production: 1 })),
    links: [],
    ...extra,
  };
}

describe('hex coordinates', () => {
  it('has six distinct neighbors, all at distance 1', () => {
    const origin = { q: 0, r: 0 };
    const neighbors = hexNeighbors(origin);
    expect(new Set(neighbors.map(hexKey)).size).toBe(6);
    for (const n of neighbors) expect(hexDistance(origin, n)).toBe(1);
  });

  it('measures distances', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 1 })).toBe(3);
    expect(hexDistance({ q: 4, r: 2 }, { q: 4, r: 2 })).toBe(0);
    expect(hexDistance({ q: -2, r: 5 }, { q: 3, r: 1 })).toBe(hexDistance({ q: 3, r: 1 }, { q: -2, r: 5 }));
  });

  it('converts hex to pixel and back, also for points inside the hex', () => {
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const p = hexToPixel({ q, r }, 10);
        expect(pixelToHex(p.x, p.y, 10)).toEqual({ q, r });
        expect(pixelToHex(p.x + 3, p.y - 2, 10)).toEqual({ q, r });
      }
    }
  });

  it('lines edges up with neighbor directions', () => {
    const origin = { q: 2, r: -1 };
    const corners = hexCorners(origin, 1);
    const center = hexToPixel(origin, 1);
    HEX_DIRECTIONS.forEach((d, i) => {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const neighbor = hexToPixel({ q: origin.q + d.q, r: origin.r + d.r }, 1);
      expect(a && b).toBeTruthy();
      if (!a || !b) return;
      // The edge midpoint is halfway between the two hex centers.
      expect((a.x + b.x) / 2).toBeCloseTo((center.x + neighbor.x) / 2, 9);
      expect((a.y + b.y) / 2).toBeCloseTo((center.y + neighbor.y) / 2, 9);
    });
    expect(SQRT3).toBeCloseTo(1.7320508, 5);
  });
});

describe('seeded random', () => {
  it('is deterministic and in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('hashes and noises deterministically within [0, 1)', () => {
    expect(hash2(3, 4, 9)).toBe(hash2(3, 4, 9));
    expect(hash2(3, 4, 9)).not.toBe(hash2(3, 4, 10));
    for (let i = 0; i < 100; i++) {
      for (const v of [valueNoise(i * 0.37, i * 0.11, 5), fbm(i * 0.21, i * 0.53, 5, 4)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is smooth: nearby points have nearby values', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.73;
      expect(Math.abs(valueNoise(x, 2.1, 3) - valueNoise(x + 0.001, 2.1, 3))).toBeLessThan(0.01);
    }
  });
});

describe('generateHexMap', () => {
  const base = { width: 40, height: 28, provinceCount: 14 };

  it('is deterministic for the same seed and different for another one', () => {
    expect(generateHexMap({ ...base, seed: 5 })).toEqual(generateHexMap({ ...base, seed: 5 }));
    expect(generateHexMap({ ...base, seed: 5 })).not.toEqual(generateHexMap({ ...base, seed: 6 }));
  });

  it('always produces valid, connected maps', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const map = generateHexMap({ ...base, seed });
      expect(validateHexMap(map)).toEqual([]);
      expect(map.provinces).toHaveLength(14);
    }
  });

  it('reaches roughly the requested land ratio', () => {
    const map = generateHexMap({ ...base, seed: 2, landRatio: 0.6 });
    const land = map.cells.filter((c) => c.kind === 'land').length;
    expect(land / map.cells.length).toBeGreaterThan(0.5);
    expect(land / map.cells.length).toBeLessThan(0.7);
  });

  it('gives every province several cells and uses all configured resources', () => {
    const map = generateHexMap({ width: 60, height: 40, provinceCount: 30, seed: 4 });
    const counts = new Map<string, number>();
    for (const cell of map.cells) {
      if (cell.province) counts.set(cell.province, (counts.get(cell.province) ?? 0) + 1);
    }
    expect(Math.min(...counts.values())).toBeGreaterThanOrEqual(3);
    expect(new Set(map.provinces.map((p) => p.resource)).size).toBeGreaterThan(1);
    for (const p of map.provinces) {
      expect(p.production).toBeGreaterThanOrEqual(1);
      expect(p.production).toBeLessThanOrEqual(3);
    }
  });

  it('keeps provinces connected at any roughness', () => {
    for (const roughness of [0, 1.2, 4]) {
      const map = generateHexMap({ ...base, seed: 9, roughness });
      expect(validateHexMap(map)).toEqual([]);
    }
  });

  it('links separate islands with sea routes', () => {
    const options = { width: 40, height: 28, provinceCount: 12, landRatio: 0.2, seed: 3 };

    const without = generateHexMap({ ...options, connectIslands: false });
    expect(validateHexMap(without).map((i) => i.code)).toContain('disconnected_map');

    const withBridges = generateHexMap(options);
    expect(withBridges.links.length).toBeGreaterThanOrEqual(1);
    expect(validateHexMap(withBridges)).toEqual([]);
    expect(connectedGroups(withBridges)).toHaveLength(1);
  });

  it('fills tiny enclosed lakes', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const map = generateHexMap({ ...base, seed, maxLakeCells: 3 });
      const index = new Map(map.cells.map((c) => [hexKey(c), c]));
      for (const cell of map.cells) {
        if (cell.kind !== 'sea') continue;
        const neighbors = hexNeighbors(cell).map((n) => index.get(hexKey(n)));
        const insideGrid = neighbors.every((n) => n !== undefined);
        // A sea cell completely surrounded by land is a one-cell lake.
        if (insideGrid) expect(neighbors.some((n) => n?.kind === 'sea')).toBe(true);
      }
    }
  });

  it('shrinks the province count when there is too little land', () => {
    const map = generateHexMap({ width: 5, height: 5, provinceCount: 100, seed: 1, landRatio: 0.5 });
    expect(map.provinces.length).toBeLessThan(100);
    expect(map.provinces.length).toBeGreaterThan(0);
    expect(validateHexMap(map)).toEqual([]);
  });

  it('rejects invalid options', () => {
    expect(() => generateHexMap({ seed: 1, width: 2, height: 10, provinceCount: 3 })).toThrow();
    expect(() => generateHexMap({ seed: 1, width: 10, height: 10, provinceCount: 0 })).toThrow();
  });
});

describe('toMapDef', () => {
  const twoProvinces = () =>
    handMap({
      A: [[0, 0], [1, 0]],
      B: [[2, 0], [3, 0]],
    });

  it('links provinces that share a border, with distances from their centers', () => {
    const def = toMapDef(twoProvinces(), { distancePerHex: 1, minDistance: 0.1 });
    // Centers are 2 hexes apart.
    expect(def.edges).toEqual([{ a: 'A', b: 'B', distance: 2 }]);
    expect(def.provinces.map((p) => p.id)).toEqual(['A', 'B']);
  });

  it('never goes below the minimum distance', () => {
    const def = toMapDef(twoProvinces(), { distancePerHex: 0.01, minDistance: 1 });
    expect(def.edges[0]?.distance).toBe(1);
  });

  it('adds manual links, with explicit or computed distances', () => {
    const map = handMap(
      {
        A: [[0, 0]],
        B: [[1, 0]],
        C: [[10, 0]],
        D: [[20, 0]],
      },
      {
        links: [
          { a: 'A', b: 'C', distance: 7 },
          { a: 'D', b: 'C' },
        ],
      },
    );
    const def = toMapDef(map, { distancePerHex: 1, minDistance: 0.1, linkFactor: 2 });
    const find = (a: string, b: string) => def.edges.find((e) => e.a === a && e.b === b)?.distance;

    expect(find('A', 'B')).toBe(1);
    expect(find('A', 'C')).toBe(7);
    // C and D are 10 hexes apart: 10 * 1 * 2.
    expect(find('C', 'D')).toBe(20);
  });

  it('produces clean edges on generated maps', () => {
    const map = generateHexMap({ width: 40, height: 28, provinceCount: 16, seed: 8 });
    const def = toMapDef(map);
    const ids = new Set(def.provinces.map((p) => p.id));
    const seen = new Set<string>();
    for (const edge of def.edges) {
      expect(edge.a < edge.b).toBe(true);
      expect(ids.has(edge.a) && ids.has(edge.b)).toBe(true);
      expect(edge.distance).toBeGreaterThanOrEqual(1);
      const key = `${edge.a}|${edge.b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(adjacentProvincePairs(map).length).toBeLessThanOrEqual(def.edges.length);
  });

  it('keeps anchors inside their province', () => {
    const map = generateHexMap({ width: 40, height: 28, provinceCount: 16, seed: 8 });
    const index = new Map(map.cells.map((c) => [hexKey(c), c]));
    for (const [id, hex] of provinceAnchors(map)) {
      expect(index.get(hexKey(hex))?.province).toBe(id);
    }
  });
});

describe('bridge links', () => {
  it('joins the closest provinces of separate groups', () => {
    const map = handMap({
      A: [[0, 0]],
      B: [[1, 0]],
      C: [[8, 0]],
      D: [[9, 0]],
    });
    expect(connectedGroups(map)).toHaveLength(2);
    expect(findBridgeLinks(map)).toEqual([{ a: 'B', b: 'C' }]);
  });
});

describe('validateHexMap', () => {
  const codes = (map: HexMapData) => validateHexMap(map).map((i) => i.code);

  it('accepts a correct map', () => {
    expect(validateHexMap(handMap({ A: [[0, 0], [1, 0]], B: [[2, 0]] }))).toEqual([]);
  });

  it('detects broken cells', () => {
    const map = handMap({ A: [[0, 0]] });
    map.cells.push({ q: 0, r: 0, kind: 'land', province: 'A' });
    map.cells.push({ q: 1, r: 0, kind: 'land', province: null });
    map.cells.push({ q: 2, r: 0, kind: 'land', province: 'Z' });
    map.cells.push({ q: 3, r: 0, kind: 'sea', province: 'A' });
    expect(codes(map)).toEqual(
      expect.arrayContaining(['duplicate_cell', 'land_without_province', 'unknown_province', 'sea_with_province']),
    );
  });

  it('detects duplicate, empty and split provinces', () => {
    const map = handMap({ A: [[0, 0], [5, 0]], B: [[1, 0]] });
    map.provinces.push({ id: 'B', name: 'again', resource: 'grain', production: 1 });
    map.provinces.push({ id: 'E', name: 'empty', resource: 'grain', production: 1 });
    expect(codes(map)).toEqual(expect.arrayContaining(['duplicate_province', 'empty_province', 'disconnected_province']));
  });

  it('detects bad links and disconnected maps', () => {
    const map = handMap({ A: [[0, 0]], B: [[5, 0]] }, { links: [{ a: 'A', b: 'nope' }] });
    expect(codes(map)).toEqual(expect.arrayContaining(['bad_link', 'disconnected_map']));

    const zero = handMap({ A: [[0, 0]], B: [[1, 0]] }, { links: [{ a: 'A', b: 'B', distance: 0 }] });
    expect(codes(zero)).toContain('bad_link');
  });
});

describe('borders and SVG', () => {
  it('draws six coastline segments around a lone hex', () => {
    const segments = extractBorders(handMap({ A: [[0, 0]] }), 1);
    expect(segments).toHaveLength(6);
    expect(segments.every((s) => s.b === null)).toBe(true);
  });

  it('draws a shared border only once', () => {
    const segments = extractBorders(handMap({ A: [[0, 0]], B: [[1, 0]] }), 1);
    const shared = segments.filter((s) => s.b !== null);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ a: 'A', b: 'B' });
    // 5 coast segments for each hex, plus the shared one.
    expect(segments).toHaveLength(11);
  });

  it('renders a standalone SVG with the province labels', () => {
    const map = generateHexMap({ width: 20, height: 14, provinceCount: 5, seed: 2 });
    const svg = renderSvg(map, { showGraph: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    for (const p of map.provinces) expect(svg).toContain(`>${p.id}</text>`);
  });

  it('does not fail on an empty map', () => {
    const svg = renderSvg({ id: 'empty', cells: [], provinces: [], links: [] });
    expect(svg).toContain('<svg');
  });
});

describe('from hexes to a playable game', () => {
  const map = generateHexMap({ width: 44, height: 30, provinceCount: 18, seed: 11 });
  const def = toMapDef(map);

  it('gives a graph where every province can reach every other', () => {
    const first = def.provinces[0]?.id ?? '';
    for (const province of def.provinces) {
      expect(findPath(def.edges, first, province.id)).not.toBeNull();
    }
  });

  it('is accepted by createGame and playable by the AI', () => {
    const ids = def.provinces.map((p) => p.id);
    const redHome = ids[0] ?? '';
    const blueHome = ids[ids.length - 1] ?? '';
    const state = createGame({
      map: def,
      rules: baseRuleset,
      players: [
        { id: 'red', name: 'Red' },
        { id: 'blue', name: 'Blue' },
      ],
      owners: { [redHome]: 'red', [blueHome]: 'blue' },
      armies: [
        { id: 'r1', owner: 'red', location: redHome, units: { infantry: 10 } },
        { id: 'b1', owner: 'blue', location: blueHome, units: { infantry: 10 } },
      ],
    });

    const final = runMatch(state, baseRuleset, { aiPlayers: ['red', 'blue'], maxTicks: 60 });
    expect(final.tick).toBeGreaterThan(0);
    // Somebody must have expanded beyond the starting province.
    expect(final.provinces.filter((p) => p.owner !== null).length).toBeGreaterThan(2);
  });
});
