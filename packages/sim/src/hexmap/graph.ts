import type { Edge, MapDef, ProvinceId } from '../types';
import { SQRT3, hexKey, hexNeighbors, hexToPixel, type Hex, type Point } from './hex';
import type { HexCell, HexLink, HexMapData } from './types';

export function buildCellIndex(map: HexMapData): Map<string, HexCell> {
  return new Map(map.cells.map((c) => [hexKey(c), c]));
}

/** Province pairs that share at least one hex edge, sorted and without duplicates. */
export function adjacentProvincePairs(map: HexMapData): [ProvinceId, ProvinceId][] {
  const index = buildCellIndex(map);
  const seen = new Set<string>();
  const pairs: [ProvinceId, ProvinceId][] = [];

  for (const cell of map.cells) {
    if (cell.kind !== 'land' || cell.province === null) continue;
    for (const n of hexNeighbors(cell)) {
      const other = index.get(hexKey(n));
      if (!other || other.kind !== 'land' || other.province === null) continue;
      if (other.province === cell.province) continue;
      const [a, b] =
        cell.province < other.province ? [cell.province, other.province] : [other.province, cell.province];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
  }
  return pairs.sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]));
}

/** Cells of each province. */
export function cellsByProvince(map: HexMapData): Map<ProvinceId, HexCell[]> {
  const groups = new Map<ProvinceId, HexCell[]>();
  for (const cell of map.cells) {
    if (cell.kind !== 'land' || cell.province === null) continue;
    const list = groups.get(cell.province) ?? [];
    list.push(cell);
    groups.set(cell.province, list);
  }
  return groups;
}

/**
 * Center of mass of each province, in "hex widths": 1 unit is the distance between
 * the centers of two neighboring hexes.
 */
export function provinceCentroids(map: HexMapData): Map<ProvinceId, Point> {
  const result = new Map<ProvinceId, Point>();
  for (const [id, cells] of cellsByProvince(map)) {
    let x = 0;
    let y = 0;
    for (const cell of cells) {
      const p = hexToPixel(cell, 1);
      x += p.x;
      y += p.y;
    }
    result.set(id, { x: x / cells.length / SQRT3, y: y / cells.length / SQRT3 });
  }
  return result;
}

/**
 * The cell of each province closest to its centroid. Unlike the centroid it always
 * lies inside the province, so it is a good place for labels and army markers.
 */
export function provinceAnchors(map: HexMapData): Map<ProvinceId, Hex> {
  const centroids = provinceCentroids(map);
  const anchors = new Map<ProvinceId, Hex>();
  for (const [id, cells] of cellsByProvince(map)) {
    const centroid = centroids.get(id);
    if (!centroid) continue;
    let best: { hex: Hex; d: number } | null = null;
    for (const cell of cells) {
      const p = hexToPixel(cell, 1);
      const d = Math.hypot(p.x / SQRT3 - centroid.x, p.y / SQRT3 - centroid.y);
      if (!best || d < best.d || (d === best.d && hexKey(cell) < hexKey(best.hex))) {
        best = { hex: { q: cell.q, r: cell.r }, d };
      }
    }
    if (best) anchors.set(id, best.hex);
  }
  return anchors;
}

export interface ToMapDefOptions {
  /** Travel distance per hex width between province centers. Default 0.25. */
  distancePerHex?: number;
  /** Smallest allowed edge distance. Default 1. */
  minDistance?: number;
  /** Multiplier for links without an explicit distance (sea crossings are slower). Default 1.5. */
  linkFactor?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Derives the province graph the game runs on:
 * provinces sharing a border are adjacent, plus the manual links of the map.
 * Distances come from the distance between province centers, so bigger provinces
 * take longer to cross.
 */
export function toMapDef(map: HexMapData, options: ToMapDefOptions = {}): MapDef {
  const scale = options.distancePerHex ?? 0.25;
  const minDistance = options.minDistance ?? 1;
  const linkFactor = options.linkFactor ?? 1.5;
  const centroids = provinceCentroids(map);

  const distanceBetween = (a: ProvinceId, b: ProvinceId, factor: number): number => {
    const pa = centroids.get(a);
    const pb = centroids.get(b);
    if (!pa || !pb) return minDistance;
    return Math.max(minDistance, round1(Math.hypot(pa.x - pb.x, pa.y - pb.y) * scale * factor));
  };

  const edges = new Map<string, Edge>();
  const addEdge = (a: ProvinceId, b: ProvinceId, distance: number) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    edges.set(`${x}|${y}`, { a: x, b: y, distance });
  };

  for (const [a, b] of adjacentProvincePairs(map)) addEdge(a, b, distanceBetween(a, b, 1));
  for (const link of map.links) {
    addEdge(link.a, link.b, link.distance ?? distanceBetween(link.a, link.b, linkFactor));
  }

  return {
    id: map.id,
    provinces: map.provinces.map((p) => ({ ...p })),
    edges: [...edges.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
  };
}

/** Groups of provinces connected to each other, counting adjacency and manual links. */
export function connectedGroups(map: HexMapData): ProvinceId[][] {
  const parent = new Map<ProvinceId, ProvinceId>(map.provinces.map((p) => [p.id, p.id]));
  const find = (x: ProvinceId): ProvinceId => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  const union = (a: ProvinceId, b: ProvinceId) => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };

  for (const [a, b] of adjacentProvincePairs(map)) union(a, b);
  for (const link of map.links) union(link.a, link.b);

  const groups = new Map<ProvinceId, ProvinceId[]>();
  for (const p of map.provinces) {
    const root = find(p.id);
    const list = groups.get(root) ?? [];
    list.push(p.id);
    groups.set(root, list);
  }
  return [...groups.values()].sort((x, y) => y.length - x.length || (x[0] ?? '').localeCompare(y[0] ?? ''));
}

/**
 * Links needed to make the whole map connected (for example islands): repeatedly
 * joins the two closest provinces that belong to different groups.
 */
export function findBridgeLinks(map: HexMapData): HexLink[] {
  const centroids = provinceCentroids(map);
  const links: HexLink[] = [];
  const working: HexMapData = { ...map, links: [...map.links] };

  for (;;) {
    const groups = connectedGroups(working);
    if (groups.length <= 1) return links;

    const main = new Set(groups[0] ?? []);
    let best: { a: ProvinceId; b: ProvinceId; d: number } | null = null;

    // Connect the biggest group to the closest province outside of it.
    for (const a of [...main].sort()) {
      const pa = centroids.get(a);
      if (!pa) continue;
      for (const group of groups.slice(1)) {
        for (const b of [...group].sort()) {
          const pb = centroids.get(b);
          if (!pb) continue;
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
    }
    if (!best) return links;

    const link: HexLink = { a: best.a, b: best.b };
    links.push(link);
    working.links.push(link);
  }
}

export interface HexMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Pixel rectangle that contains every hex of the map, plus an optional margin. */
export function hexMapBounds(map: HexMapData, size = 1, margin = 0): HexMapBounds {
  if (map.cells.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of map.cells) {
    const center = hexToPixel(cell, size);
    // A pointy-top hex is sqrt(3) * size wide and 2 * size tall.
    minX = Math.min(minX, center.x - (SQRT3 * size) / 2);
    maxX = Math.max(maxX, center.x + (SQRT3 * size) / 2);
    minY = Math.min(minY, center.y - size);
    maxY = Math.max(maxY, center.y + size);
  }
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
