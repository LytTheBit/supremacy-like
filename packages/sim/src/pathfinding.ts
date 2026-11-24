import type { Edge, ProvinceId } from './types';

export interface Neighbor {
  to: ProvinceId;
  distance: number;
}

export interface PathResult {
  /** Provinces to visit in order. Excludes the starting province. */
  path: ProvinceId[];
  /** Total distance of the path. */
  distance: number;
}

/** Builds an undirected adjacency list, sorted by id for deterministic results. */
export function buildAdjacency(edges: Edge[]): Map<ProvinceId, Neighbor[]> {
  const adjacency = new Map<ProvinceId, Neighbor[]>();
  const add = (from: ProvinceId, to: ProvinceId, distance: number) => {
    const list = adjacency.get(from) ?? [];
    list.push({ to, distance });
    adjacency.set(from, list);
  };
  for (const edge of edges) {
    add(edge.a, edge.b, edge.distance);
    add(edge.b, edge.a, edge.distance);
  }
  for (const list of adjacency.values()) {
    list.sort((x, y) => x.to.localeCompare(y.to));
  }
  return adjacency;
}

/** Returns a lookup function for the distance of an edge, or undefined if not adjacent. */
export function makeEdgeDistance(edges: Edge[]): (a: ProvinceId, b: ProvinceId) => number | undefined {
  const adjacency = buildAdjacency(edges);
  return (a, b) => adjacency.get(a)?.find((n) => n.to === b)?.distance;
}

/**
 * Shortest path by total distance (not by number of hops).
 * Ties are broken by province id so the result is deterministic.
 * Returns null when the target is unreachable (with `canStep`, steps it refuses do not exist).
 */
export function findPath(
  edges: Edge[],
  from: ProvinceId,
  to: ProvinceId,
  /** Optional rule that says whether the step between two adjacent provinces is allowed. */
  canStep?: (from: ProvinceId, to: ProvinceId) => boolean,
): PathResult | null {
  if (from === to) return { path: [], distance: 0 };

  const adjacency = buildAdjacency(edges);
  const dist = new Map<ProvinceId, number>([[from, 0]]);
  const prev = new Map<ProvinceId, ProvinceId>();
  const visited = new Set<ProvinceId>();

  for (;;) {
    // Pick the closest unvisited node (graphs are small, a linear scan is fine).
    const candidates = [...dist.entries()]
      .filter(([id]) => !visited.has(id))
      .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
    const current = candidates[0];
    if (!current) break;

    const [node, nodeDist] = current;
    if (node === to) break;
    visited.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (canStep && !canStep(node, neighbor.to)) continue;
      const candidate = nodeDist + neighbor.distance;
      if (candidate < (dist.get(neighbor.to) ?? Infinity)) {
        dist.set(neighbor.to, candidate);
        prev.set(neighbor.to, node);
      }
    }
  }

  const total = dist.get(to);
  if (total === undefined) return null;

  const path: ProvinceId[] = [];
  let cursor: ProvinceId | undefined = to;
  while (cursor !== undefined && cursor !== from) {
    path.unshift(cursor);
    cursor = prev.get(cursor);
  }
  return { path, distance: total };
}
