import type { ProvinceDef, ResourceId } from '../types';
import { findBridgeLinks } from './graph';
import { SQRT3, hexDistance, hexKey, hexNeighbors, hexToPixel, type Hex } from './hex';
import { fbm, hash2, mulberry32, randomInt } from './random';
import type { HexCell, HexMapData } from './types';

export interface GenerateOptions {
  /** Same seed and options always produce the same map. */
  seed: number;
  /** Grid size in hexes. */
  width: number;
  height: number;
  /** Wanted number of provinces (reduced if the land is too small). */
  provinceCount: number;
  id?: string;
  /** Share of the grid that becomes land, 0..1. Default 0.6. */
  landRatio?: number;
  /**
   * How ragged province borders are. 0 gives clean Voronoi-like shapes,
   * higher values give more organic, real-looking borders. Default 1.2.
   */
  roughness?: number;
  /** Land pieces smaller than this are dropped (tiny islands). Default 8. */
  minIslandCells?: number;
  /** Resources assigned to provinces. Default: wood, iron, grain, coal. */
  resources?: ResourceId[];
  /** Highest production of a province, in `productionUnit`s. Default 3. */
  maxProduction?: number;
  /** Size of one production step, matching the resource scale of the ruleset. Default 1000. */
  productionUnit?: number;
  /** Link separate islands with sea routes so the map stays connected. Default true. */
  connectIslands?: boolean;
  /** Enclosed sea areas up to this size are filled in as land. Default 3. */
  maxLakeCells?: number;
}

/**
 * Generates a hexagonal map with provinces.
 *
 * 1. Land/sea: fractal noise with a soft falloff towards the edges, cut so that
 *    exactly `landRatio` of the cells are land.
 * 2. Province seeds: spread out with farthest-point sampling (islands get at
 *    least one seed each, bigger ones get more).
 * 3. Growth: a flood fill from all seeds at once where entering a cell costs
 *    1 + noise. The noise makes borders ragged and natural, and the flood fill
 *    guarantees every province is a single connected piece.
 */
export function generateHexMap(options: GenerateOptions): HexMapData {
  const { seed, width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4) {
    throw new Error('width and height must be integers of at least 4');
  }
  if (!Number.isInteger(options.provinceCount) || options.provinceCount < 1) {
    throw new Error('provinceCount must be a positive integer');
  }

  const landRatio = clamp(options.landRatio ?? 0.6, 0.05, 1);
  const roughness = Math.max(0, options.roughness ?? 1.2);
  const minIslandCells = Math.max(1, options.minIslandCells ?? 8);
  const resources = options.resources ?? ['wood', 'iron', 'grain', 'coal'];
  const maxProduction = Math.max(1, Math.floor(options.maxProduction ?? 3));
  const productionUnit = options.productionUnit ?? 1000;
  const rng = mulberry32(seed);

  // --- Grid: rows of `width` hexes, offset so the shape stays a rectangle -------
  const hexes: Hex[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      hexes.push({ q: col - Math.floor(row / 2), r: row });
    }
  }
  const total = hexes.length;
  const indexOf = new Map<string, number>(hexes.map((h, i) => [hexKey(h), i]));
  const neighbors: number[][] = hexes.map((h) =>
    hexNeighbors(h)
      .map((n) => indexOf.get(hexKey(n)))
      .filter((i): i is number => i !== undefined),
  );
  // Pseudo-Euclidean coordinates, used to sample noise without hex distortion.
  const planar = hexes.map((h) => {
    const p = hexToPixel(h, 1);
    return { x: p.x / SQRT3, y: p.y / SQRT3 };
  });

  // --- 1. Land mask ---------------------------------------------------------------
  const centerX = width / 2;
  const centerY = (height * 0.866) / 2;
  const score = planar.map((p) => {
    const nx = (p.x - centerX) / (width / 2);
    const ny = (p.y - centerY) / ((height * 0.866) / 2);
    const falloff = Math.min(1.5, nx * nx + ny * ny);
    return fbm(p.x * 0.09, p.y * 0.09, seed, 4) - 0.55 * falloff;
  });
  const wantedLand = clamp(
    Math.round(total * landRatio),
    Math.min(total, options.provinceCount),
    total,
  );
  const byScore = [...Array(total).keys()].sort((x, y) => (score[y] ?? 0) - (score[x] ?? 0) || x - y);
  const isLand: boolean[] = Array<boolean>(total).fill(false);
  for (const i of byScore.slice(0, wantedLand)) isLand[i] = true;

  // --- Land pieces: drop tiny islands, keep at most `provinceCount` pieces --------
  let components = landComponents(isLand, neighbors).filter((c) => c.length >= minIslandCells);
  if (components.length === 0) {
    // Everything was tiny: keep the biggest piece whatever its size.
    const all = landComponents(isLand, neighbors).sort((x, y) => y.length - x.length);
    components = all.slice(0, 1);
  }
  components.sort((x, y) => y.length - x.length || (x[0] ?? 0) - (y[0] ?? 0));
  components = components.slice(0, options.provinceCount);
  isLand.fill(false);
  for (const component of components) for (const i of component) isLand[i] = true;

  const landTotal = components.reduce((sum, c) => sum + c.length, 0);
  const provinceCount = Math.min(options.provinceCount, landTotal);

  // --- 2. Seeds ---------------------------------------------------------------------
  const allocation = allocateSeeds(
    components.map((c) => c.length),
    provinceCount,
  );
  const seeds: number[] = [];
  components.forEach((component, c) => {
    seeds.push(...pickSeeds(component, allocation[c] ?? 1, hexes, rng));
  });

  // --- 3. Noisy flood fill ----------------------------------------------------------
  const noiseSeed = seed + 7919;
  const stepCost = planar.map((p) => 1 + roughness * fbm(p.x * 0.4, p.y * 0.4, noiseSeed, 2));
  const owner: number[] = Array<number>(total).fill(-1);
  const dist: number[] = Array<number>(total).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((cell, s) => {
    owner[cell] = s;
    dist[cell] = 0;
    heap.push(0, cell);
  });
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const [d, cell] = top;
    if (d > (dist[cell] ?? Infinity)) continue;
    for (const n of neighbors[cell] ?? []) {
      if (!isLand[n]) continue;
      const nd = d + (stepCost[n] ?? 1);
      if (nd < (dist[n] ?? Infinity)) {
        dist[n] = nd;
        owner[n] = owner[cell] ?? -1;
        heap.push(nd, n);
      }
    }
  }
  for (let i = 0; i < total; i++) {
    if (isLand[i] && (owner[i] ?? -1) < 0) isLand[i] = false; // unreachable: cannot happen, but stay safe
  }
  fillSmallLakes(isLand, owner, neighbors, Math.max(0, options.maxLakeCells ?? 3));

  // --- Provinces ----------------------------------------------------------------------
  const pad = String(seeds.length).length;
  const provinceIds = seeds.map((_, s) => `p${String(s + 1).padStart(pad, '0')}`);
  const sums = seeds.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let i = 0; i < total; i++) {
    const s = owner[i] ?? -1;
    const p = planar[i];
    const acc = sums[s];
    if (isLand[i] && s >= 0 && p && acc) {
      acc.x += p.x;
      acc.y += p.y;
      acc.n += 1;
    }
  }

  const provinces: ProvinceDef[] = provinceIds.map((id, s) => {
    const acc = sums[s] ?? { x: 0, y: 0, n: 1 };
    const cx = acc.x / Math.max(1, acc.n);
    const cy = acc.y / Math.max(1, acc.n);
    // Neighboring provinces tend to share a resource: it varies slowly over the map.
    const regional = fbm(cx * 0.12, cy * 0.12, seed + 31, 2);
    const resource = resources[Math.min(resources.length - 1, Math.floor(regional * resources.length))] ?? 'grain';
    return {
      id,
      name: `Province ${s + 1}`,
      resource,
      production: (1 + Math.floor(hash2(s, 17, seed) * maxProduction)) * productionUnit,
    };
  });

  const cells: HexCell[] = hexes.map((h, i) => {
    const s = owner[i] ?? -1;
    const land = isLand[i] === true && s >= 0;
    return { q: h.q, r: h.r, kind: land ? 'land' : 'sea', province: land ? (provinceIds[s] ?? null) : null };
  });

  const map: HexMapData = { id: options.id ?? `generated-${seed}`, cells, provinces, links: [] };
  if (options.connectIslands ?? true) map.links = findBridgeLinks(map);
  return map;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Connected groups of land cells (as arrays of cell indexes). */
function landComponents(isLand: boolean[], neighbors: number[][]): number[][] {
  const seen: boolean[] = Array<boolean>(isLand.length).fill(false);
  const components: number[][] = [];
  for (let start = 0; start < isLand.length; start++) {
    if (!isLand[start] || seen[start]) continue;
    const component: number[] = [];
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const cell = stack.pop();
      if (cell === undefined) break;
      component.push(cell);
      for (const n of neighbors[cell] ?? []) {
        if (isLand[n] && !seen[n]) {
          seen[n] = true;
          stack.push(n);
        }
      }
    }
    components.push(component.sort((x, y) => x - y));
  }
  return components;
}

/**
 * Fills small enclosed sea areas (not connected to the map border) with the
 * province most common around them, so provinces have no tiny holes.
 */
function fillSmallLakes(isLand: boolean[], owner: number[], neighbors: number[][], maxSize: number): void {
  if (maxSize <= 0) return;
  const seen: boolean[] = Array<boolean>(isLand.length).fill(false);

  for (let start = 0; start < isLand.length; start++) {
    if (isLand[start] || seen[start]) continue;

    const lake: number[] = [];
    const stack = [start];
    seen[start] = true;
    let touchesBorder = false;
    while (stack.length > 0) {
      const cell = stack.pop();
      if (cell === undefined) break;
      lake.push(cell);
      // Cells on the grid border have fewer than 6 neighbors.
      if ((neighbors[cell]?.length ?? 0) < 6) touchesBorder = true;
      for (const n of neighbors[cell] ?? []) {
        if (!isLand[n] && !seen[n]) {
          seen[n] = true;
          stack.push(n);
        }
      }
    }
    if (touchesBorder || lake.length > maxSize) continue;

    const votes = new Map<number, number>();
    for (const cell of lake) {
      for (const n of neighbors[cell] ?? []) {
        const o = owner[n] ?? -1;
        if (isLand[n] && o >= 0) votes.set(o, (votes.get(o) ?? 0) + 1);
      }
    }
    const winner = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
    if (!winner) continue;
    for (const cell of lake) {
      isLand[cell] = true;
      owner[cell] = winner[0];
    }
  }
}

/** Splits `total` seeds between land pieces in proportion to their size (min 1 each). */
function allocateSeeds(sizes: number[], total: number): number[] {
  const allocation = sizes.map(() => 1);
  let remaining = total - sizes.length;
  const sum = sizes.reduce((a, b) => a + b, 0);

  // Proportional share first, then hand out leftovers to the largest remainders.
  const shares = sizes.map((s) => (remaining * s) / sum);
  shares.forEach((share, i) => {
    const give = Math.min(Math.floor(share), (sizes[i] ?? 1) - (allocation[i] ?? 1));
    allocation[i] = (allocation[i] ?? 1) + give;
    remaining -= give;
  });
  const order = shares
    .map((share, i) => ({ i, frac: share - Math.floor(share) }))
    .sort((x, y) => y.frac - x.frac || x.i - y.i);
  while (remaining > 0) {
    let gave = false;
    for (const { i } of order) {
      if (remaining <= 0) break;
      if ((allocation[i] ?? 1) < (sizes[i] ?? 1)) {
        allocation[i] = (allocation[i] ?? 1) + 1;
        remaining -= 1;
        gave = true;
      }
    }
    if (!gave) break;
  }
  return allocation;
}

/**
 * Farthest-point sampling inside one land piece: each new seed is far from the
 * previous ones. A little randomness among the best candidates avoids a too regular layout.
 */
function pickSeeds(component: number[], count: number, hexes: Hex[], rng: () => number): number[] {
  const first = component[randomInt(rng, component.length)];
  if (first === undefined) return [];
  const chosen = [first];
  const minDist = new Map<number, number>();
  const update = (seedCell: number) => {
    const seedHex = hexes[seedCell];
    if (!seedHex) return;
    for (const cell of component) {
      const h = hexes[cell];
      if (!h) continue;
      const d = hexDistance(seedHex, h);
      const known = minDist.get(cell);
      if (known === undefined || d < known) minDist.set(cell, d);
    }
  };
  update(first);

  while (chosen.length < count) {
    const candidates = component
      .filter((c) => !chosen.includes(c))
      .sort((x, y) => (minDist.get(y) ?? 0) - (minDist.get(x) ?? 0) || x - y);
    if (candidates.length === 0) break;
    const pool = Math.max(1, Math.floor(candidates.length * 0.04));
    const next = candidates[randomInt(rng, pool)];
    if (next === undefined) break;
    chosen.push(next);
    update(next);
  }
  return chosen;
}

/** Minimal binary min-heap of [priority, value], ties broken by value for determinism. */
class MinHeap {
  private items: [number, number][] = [];

  push(priority: number, value: number): void {
    this.items.push([priority, value]);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  pop(): [number, number] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined) return top;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (right < this.items.length && this.less(right, smallest)) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    if (!x || !y) return false;
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }

  private swap(a: number, b: number): void {
    const x = this.items[a];
    const y = this.items[b];
    if (!x || !y) return;
    this.items[a] = y;
    this.items[b] = x;
  }
}
