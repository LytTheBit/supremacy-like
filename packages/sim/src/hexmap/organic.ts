import type { ProvinceId } from '../types';
import { buildCellIndex } from './graph';
import { HEX_DIRECTIONS, hexCorners, hexKey, type Point } from './hex';
import { hash2, valueNoise } from './random';
import type { HexMapData } from './types';

/**
 * Organic outlines: a purely VISUAL layer on top of a hex map.
 *
 * The hexes decide which province owns which cell and therefore the game graph.
 * Drawing those borders as they are gives long straight lines and obvious hexagon
 * steps. This module turns every border into a smooth, irregular curve that looks
 * like a real map. It never changes HexMapData, so game mechanics are not affected.
 *
 * How it works:
 * 1. Border edges are found and joined into chains (a chain runs between two
 *    junctions, or is a closed loop around an island or an enclave).
 * 2. Every hex corner and every edge midpoint on a chain is nudged by a
 *    deterministic offset that depends only on its position, so the two provinces
 *    on each side of a border get exactly the same curve.
 * 3. A Catmull-Rom spline through the nudged points becomes cubic Bezier curves:
 *    no straight lines and no sharp hexagon corners.
 * 4. Each province outline is assembled from those shared curves.
 */

export interface OrganicOptions {
  /** How irregular borders are, 0..1. Default 0.5. Higher values wander further from the hex lines. */
  strength?: number;
  /** Changes the pattern of irregularities. Default 0. */
  seed?: number;
  /** Hex size in pixels (center to corner), the same unit as renderSvg. Default 1. */
  size?: number;
  /** Points sampled on each curve segment for the flattened outlines. Default 5. */
  samples?: number;
}

export interface OrganicBorder {
  a: ProvinceId;
  /** The other province, or null for a coastline. */
  b: ProvinceId | null;
  /** SVG path data of the whole border chain. */
  path: string;
  /** The same curve as a polyline. */
  points: Point[];
}

export interface OrganicShapes {
  /** SVG path data per province: closed, to be filled with the even-odd rule (islands and enclaves are holes). */
  paths: Record<ProvinceId, string>;
  /** The same outlines as polygons: one list of points per outer boundary or hole. */
  outlines: Record<ProvinceId, Point[][]>;
  /** Shared borders between provinces and coastlines, each drawn once. */
  borders: OrganicBorder[];
}

type Cubic = [Point, Point, Point, Point];

interface UndirectedEdge {
  key: string;
  u: string;
  v: string;
  a: ProvinceId;
  b: ProvinceId | null;
  /** Edges of one chain share the same pair of provinces. */
  pair: string;
}

interface DirectedEdge {
  from: string;
  to: string;
}

interface Chain {
  vertices: string[];
  edges: string[];
  closed: boolean;
  a: ProvinceId;
  b: ProvinceId | null;
}

const fmt = (n: number) => n.toFixed(2);
const vertexKey = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
const edgeKeyOf = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function reverseCubics(segments: Cubic[]): Cubic[] {
  return [...segments].reverse().map(([p0, c1, c2, p1]): Cubic => [p1, c2, c1, p0]);
}

function sampleCubic([p0, c1, c2, p1]: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

function pathData(segments: Cubic[], close: boolean): string {
  const first = segments[0];
  if (!first) return '';
  const parts = [`M${fmt(first[0].x)} ${fmt(first[0].y)}`];
  for (const [, c1, c2, p1] of segments) {
    parts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`);
  }
  if (close) parts.push('Z');
  return parts.join(' ');
}

function polyline(segments: Cubic[], samples: number): Point[] {
  const first = segments[0];
  if (!first) return [];
  const points: Point[] = [first[0]];
  for (const segment of segments) {
    for (let i = 1; i <= samples; i++) points.push(sampleCubic(segment, i / samples));
  }
  return points;
}

export function buildOrganicShapes(map: HexMapData, options: OrganicOptions = {}): OrganicShapes {
  const strength = Math.max(0, Math.min(1, options.strength ?? 0.5));
  const seed = options.seed ?? 0;
  const size = options.size ?? 1;
  const samples = Math.max(1, Math.floor(options.samples ?? 5));

  const index = buildCellIndex(map);
  const vertexPoint = new Map<string, Point>();
  const uedges = new Map<string, UndirectedEdge>();
  const directedByProvince = new Map<ProvinceId, DirectedEdge[]>();

  // --- 1. Boundary edges: every hex edge that separates a province from something else ----
  for (const cell of map.cells) {
    if (cell.province === null) continue;
    const province = cell.province;
    const corners = hexCorners(cell, size);

    HEX_DIRECTIONS.forEach((direction, i) => {
      const neighbor = index.get(hexKey({ q: cell.q + direction.q, r: cell.r + direction.r }));
      const other = neighbor?.province ?? null;
      if (other === province) return;

      const p0 = corners[i];
      const p1 = corners[(i + 1) % 6];
      if (!p0 || !p1) return;
      const k0 = vertexKey(p0);
      const k1 = vertexKey(p1);
      vertexPoint.set(k0, p0);
      vertexPoint.set(k1, p1);

      // Every cell walks its own edges in the same rotational order, so each
      // province outline is a consistently oriented loop.
      const list = directedByProvince.get(province) ?? [];
      list.push({ from: k0, to: k1 });
      directedByProvince.set(province, list);

      const key = edgeKeyOf(k0, k1);
      if (!uedges.has(key)) {
        const [a, b] =
          other === null ? [province, null] : province < other ? [province, other] : [other, province];
        uedges.set(key, { key, u: k0, v: k1, a, b, pair: `${a}|${b ?? '~'}` });
      }
    });
  }

  // --- 2. Chains: runs of edges between junctions ----------------------------------------------
  const adjacency = new Map<string, string[]>();
  for (const edge of uedges.values()) {
    for (const vertex of [edge.u, edge.v]) {
      const list = adjacency.get(vertex) ?? [];
      list.push(edge.key);
      adjacency.set(vertex, list);
    }
  }

  const visited = new Set<string>();
  const chains: Chain[] = [];

  for (const startKey of [...uedges.keys()].sort()) {
    if (visited.has(startKey)) continue;
    const first = uedges.get(startKey);
    if (!first) continue;
    visited.add(startKey);

    let vertices = [first.u, first.v];
    let edges = [startKey];
    let closed = false;

    // Grows the chain at its end through plain vertices (exactly two edges, same province pair).
    const extend = () => {
      for (;;) {
        const end = vertices[vertices.length - 1];
        const lastEdge = edges[edges.length - 1];
        if (end === undefined || lastEdge === undefined) return;
        const incident = adjacency.get(end) ?? [];
        if (incident.length !== 2) return;
        const nextKey = incident.find((k) => k !== lastEdge);
        const next = nextKey === undefined ? undefined : uedges.get(nextKey);
        if (!next || nextKey === undefined || visited.has(nextKey) || next.pair !== first.pair) return;

        visited.add(nextKey);
        const nextVertex = next.u === end ? next.v : next.u;
        edges.push(nextKey);
        vertices.push(nextVertex);
        if (nextVertex === vertices[0]) {
          closed = true;
          return;
        }
      }
    };

    extend();
    if (!closed) {
      vertices = vertices.reverse();
      edges = edges.reverse();
      extend();
    }
    chains.push({ vertices, edges, closed, a: first.a, b: first.b });
  }

  // --- 3. Irregular points and smooth curves ----------------------------------------------------
  const cornerAmp = strength * 0.5 * size;
  const midAmp = strength * 0.35 * size;

  // The offset depends only on the position, so every chain sharing a point agrees on it.
  // It mixes slow noise (broad meanders, neighbors move together) with a little
  // fine jitter (small irregularities), which looks much more like a real coastline
  // than pure per-point randomness.
  const nudge = (p: Point, salt: number, amp: number): Point => {
    const ix = Math.round((p.x / size) * 1000);
    const iy = Math.round((p.y / size) * 1000);
    const gx = (p.x / size) * 0.4;
    const gy = (p.y / size) * 0.4;
    const offset = (channel: number): number => {
      const broad = valueNoise(gx, gy, seed + salt + channel * 977) * 2 - 1;
      const fine = hash2(ix, iy, seed + salt + channel) * 2 - 1;
      return 0.75 * broad + 0.25 * fine;
    };
    return { x: p.x + offset(0) * amp, y: p.y + offset(1) * amp };
  };

  const edgeGeometry = new Map<string, { from: string; segments: Cubic[] }>();
  const borders: OrganicBorder[] = [];

  for (const chain of chains) {
    const n = chain.edges.length;
    const points: Point[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = vertexPoint.get(chain.vertices[i] ?? '');
      const p1 = vertexPoint.get(chain.vertices[i + 1] ?? '');
      if (!p0 || !p1) continue;
      points.push(nudge(p0, 11, cornerAmp));
      points.push(nudge({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, 23, midAmp));
    }
    if (!chain.closed) {
      const last = vertexPoint.get(chain.vertices[n] ?? '');
      if (last) points.push(nudge(last, 11, cornerAmp));
    }

    const m = points.length;
    if (m < 2) continue;
    const at = (j: number): Point => {
      const clamped = chain.closed ? ((j % m) + m) % m : Math.max(0, Math.min(m - 1, j));
      return points[clamped] ?? { x: 0, y: 0 };
    };

    // Catmull-Rom spline converted to cubic Beziers: two segments per hex edge.
    const cubics: Cubic[] = [];
    for (let j = 0; j < 2 * n; j++) {
      const p0 = at(j - 1);
      const p1 = at(j);
      const p2 = at(j + 1);
      const p3 = at(j + 2);
      cubics.push([
        p1,
        { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        p2,
      ]);
    }

    chain.edges.forEach((edgeKey, k) => {
      const from = chain.vertices[k];
      const pair = [cubics[2 * k], cubics[2 * k + 1]].filter((c): c is Cubic => c !== undefined);
      if (from !== undefined) edgeGeometry.set(edgeKey, { from, segments: pair });
    });

    borders.push({
      a: chain.a,
      b: chain.b,
      path: pathData(cubics, chain.closed),
      points: polyline(cubics, samples),
    });
  }

  // --- 4. Province outlines, assembled from the shared curves -----------------------------------
  const paths: Record<ProvinceId, string> = {};
  const outlines: Record<ProvinceId, Point[][]> = {};

  for (const province of map.provinces) {
    const directed = directedByProvince.get(province.id);
    if (!directed || directed.length === 0) continue;

    const outgoing = new Map<string, DirectedEdge[]>();
    for (const d of directed) {
      const list = outgoing.get(d.from) ?? [];
      list.push(d);
      outgoing.set(d.from, list);
    }

    const used = new Set<DirectedEdge>();
    const pathParts: string[] = [];
    const loops: Point[][] = [];

    for (const start of directed) {
      if (used.has(start)) continue;

      const segments: Cubic[] = [];
      let current: DirectedEdge | undefined = start;
      while (current) {
        used.add(current);
        const geometry = edgeGeometry.get(edgeKeyOf(current.from, current.to));
        if (geometry) {
          segments.push(...(geometry.from === current.from ? geometry.segments : reverseCubics(geometry.segments)));
        }
        current = outgoing.get(current.to)?.find((d) => !used.has(d));
      }

      if (segments.length > 0) {
        pathParts.push(pathData(segments, true));
        loops.push(polyline(segments, samples));
      }
    }

    paths[province.id] = pathParts.join(' ');
    outlines[province.id] = loops;
  }

  return { paths, outlines, borders };
}
