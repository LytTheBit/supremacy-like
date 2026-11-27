import { describe, expect, it } from 'vitest';
import {
  buildOrganicShapes,
  generateHexMap,
  hexKey,
  hexNeighbors,
  hexToPixel,
  renderSvg,
  toMapDef,
  type HexCell,
  type HexMapData,
  type Point,
} from '../src';

function handMap(land: Record<string, [number, number][]>): HexMapData {
  const cells: HexCell[] = [];
  for (const [province, list] of Object.entries(land)) {
    for (const [q, r] of list) cells.push({ q, r, kind: 'land', province });
  }
  return {
    id: 'hand',
    cells,
    provinces: Object.keys(land).map((id) => ({ id, name: id, resource: 'grain', production: 1 })),
    links: [],
  };
}

const SIZE = 10;
const map = generateHexMap({ width: 30, height: 20, provinceCount: 8, seed: 3 });

/** Distance from a point to the infinite line through a and b. */
function distanceToLine(p: Point, a: Point, b: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
}

describe('buildOrganicShapes', () => {
  it('is deterministic, and the seed changes the pattern', () => {
    const a = buildOrganicShapes(map, { strength: 0.6, seed: 1, size: SIZE });
    const b = buildOrganicShapes(map, { strength: 0.6, seed: 1, size: SIZE });
    const c = buildOrganicShapes(map, { strength: 0.6, seed: 2, size: SIZE });
    expect(a).toEqual(b);
    expect(a.paths).not.toEqual(c.paths);
  });

  it('is purely visual: the map data and the game graph are untouched', () => {
    const before = structuredClone(map);
    const graphBefore = toMapDef(map);

    buildOrganicShapes(map, { strength: 1, seed: 9, size: SIZE });
    renderSvg(map, { organic: 1, organicSeed: 9 });

    expect(map).toEqual(before);
    expect(toMapDef(map)).toEqual(graphBefore);
  });

  it('gives every province a closed outline', () => {
    const shapes = buildOrganicShapes(map, { strength: 0.5, size: SIZE });

    for (const province of map.provinces) {
      const path = shapes.paths[province.id];
      const loops = shapes.outlines[province.id];
      expect(path?.startsWith('M')).toBe(true);
      expect(path?.trimEnd().endsWith('Z')).toBe(true);
      expect(loops?.length).toBeGreaterThanOrEqual(1);

      for (const loop of loops ?? []) {
        expect(loop.length).toBeGreaterThan(10);
        const first = loop[0];
        const last = loop[loop.length - 1];
        // A closed loop ends where it started.
        expect(Math.hypot((first?.x ?? 0) - (last?.x ?? 0), (first?.y ?? 0) - (last?.y ?? 0))).toBeLessThan(1e-6);
      }
    }
  });

  it('draws shared borders identically for both provinces (no gaps, no overlaps)', () => {
    const shapes = buildOrganicShapes(map, { strength: 0.8, seed: 4, size: SIZE });
    const near = (p: Point, loops: Point[][]) =>
      loops.some((loop) => loop.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6));

    const shared = shapes.borders.filter((border) => border.b !== null);
    expect(shared.length).toBeGreaterThan(0);

    for (const border of shared) {
      const loopsA = shapes.outlines[border.a] ?? [];
      const loopsB = shapes.outlines[border.b ?? ''] ?? [];
      for (const point of border.points) {
        expect(near(point, loopsA)).toBe(true);
        expect(near(point, loopsB)).toBe(true);
      }
    }
  });

  it('removes straight lines: long borders wander away from the straight line', () => {
    const shapes = buildOrganicShapes(map, { strength: 0.6, seed: 4, size: SIZE });
    const long = shapes.borders.filter((border) => {
      const first = border.points[0];
      const last = border.points[border.points.length - 1];
      return first && last && Math.hypot(first.x - last.x, first.y - last.y) > 4 * SIZE;
    });
    expect(long.length).toBeGreaterThan(0);

    for (const border of long) {
      const first = border.points[0];
      const last = border.points[border.points.length - 1];
      if (!first || !last) continue;
      const deviation = Math.max(...border.points.map((p) => distanceToLine(p, first, last)));
      expect(deviation).toBeGreaterThan(0.1 * SIZE);
    }
  });

  it('keeps outlines close to the original hexes', () => {
    const shapes = buildOrganicShapes(map, { strength: 1, seed: 6, size: SIZE });
    const centers = map.cells.filter((c) => c.kind === 'land').map((c) => hexToPixel(c, SIZE));

    for (const loops of Object.values(shapes.outlines)) {
      for (const loop of loops) {
        for (const point of loop) {
          const nearest = Math.min(...centers.map((c) => Math.hypot(point.x - c.x, point.y - c.y)));
          // A hex corner is 1 size from its center; the nudge adds at most about 0.7 more.
          expect(nearest).toBeLessThan(2.2 * SIZE);
        }
      }
    }
  });

  it('a higher strength moves borders further from the hex lines', () => {
    // All corners of the original hex grid.
    const corners = map.cells.flatMap((c) => {
      const center = hexToPixel(c, SIZE);
      return Array.from({ length: 6 }, (_, i) => ({
        x: center.x + SIZE * Math.cos(((60 * i - 30) * Math.PI) / 180),
        y: center.y + SIZE * Math.sin(((60 * i - 30) * Math.PI) / 180),
      }));
    });

    const spread = (strength: number) => {
      const shapes = buildOrganicShapes(map, { strength, seed: 4, size: SIZE });
      // One province is enough for the comparison.
      const loops = Object.values(shapes.outlines)[0] ?? [];
      const points = loops.flat();
      const total = points.reduce(
        (sum, p) => sum + Math.min(...corners.map((c) => Math.hypot(p.x - c.x, p.y - c.y))),
        0,
      );
      return total / points.length;
    };
    expect(spread(0.9)).toBeGreaterThan(spread(0.2));
  });

  it('draws islands and enclaves as separate loops (holes)', () => {
    // Province A is a ring around province B.
    const ring = hexNeighbors({ q: 0, r: 0 }).map((h): [number, number] => [h.q, h.r]);
    const enclave = handMap({ A: ring, B: [[0, 0]] });
    const shapes = buildOrganicShapes(enclave, { strength: 0.5, size: SIZE });

    expect(shapes.outlines.A).toHaveLength(2); // outer boundary and the hole around B
    expect(shapes.outlines.B).toHaveLength(1);
    expect(shapes.paths.A?.match(/Z/g)).toHaveLength(2);
    expect(hexKey({ q: 0, r: 0 })).toBe('0,0');
  });

  it('handles a single hex and an empty map', () => {
    const single = buildOrganicShapes(handMap({ A: [[0, 0]] }), { strength: 0.5, size: SIZE });
    expect(single.outlines.A).toHaveLength(1);
    expect(single.borders).toHaveLength(1);
    expect(single.borders[0]?.b).toBeNull();

    const empty = buildOrganicShapes({ id: 'e', cells: [], provinces: [], links: [] });
    expect(empty).toEqual({ paths: {}, outlines: {}, borders: [] });
  });
});

describe('renderSvg with organic borders', () => {
  it('draws curves instead of hexagons when organic is set', () => {
    const organic = renderSvg(map, { organic: 0.6 });
    expect(organic).toContain('fill-rule="evenodd"');
    expect(organic).not.toContain('<polygon');
    expect(organic.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('keeps the plain hex look by default', () => {
    const plain = renderSvg(map);
    expect(plain).toContain('<polygon');
    expect(plain).not.toContain('fill-rule="evenodd"');
    expect(renderSvg(map, { organic: 0 })).toBe(plain);
  });

  it('produces different drawings for different seeds', () => {
    expect(renderSvg(map, { organic: 0.7, organicSeed: 1 })).not.toBe(renderSvg(map, { organic: 0.7, organicSeed: 2 }));
  });
});
