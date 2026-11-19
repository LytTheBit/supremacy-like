import { describe, expect, it } from 'vitest';
import { findPath, tinyMap } from '../src';

describe('pathfinding', () => {
  it('prefers the shortest distance over the fewest hops', () => {
    // westmark -> eastmark: direct edge costs 3, via midfield costs 4.
    expect(findPath(tinyMap.edges, 'westmark', 'eastmark')).toEqual({
      path: ['eastmark'],
      distance: 3,
    });

    // Make the direct edge expensive: the two-hop route must win.
    const edges = tinyMap.edges.map((e) =>
      e.a === 'westmark' && e.b === 'eastmark' ? { ...e, distance: 10 } : e,
    );
    expect(findPath(edges, 'westmark', 'eastmark')).toEqual({
      path: ['midfield', 'eastmark'],
      distance: 4,
    });
  });

  it('finds multi-hop paths across the whole map', () => {
    const result = findPath(tinyMap.edges, 'redhaven', 'bluehaven');
    expect(result?.path).toEqual(['westmark', 'eastmark', 'bluehaven']);
    expect(result?.distance).toBe(7);
  });

  it('returns an empty path when already at the target', () => {
    expect(findPath(tinyMap.edges, 'midfield', 'midfield')).toEqual({ path: [], distance: 0 });
  });

  it('returns null when the target is unreachable', () => {
    const edges = [{ a: 'x', b: 'y', distance: 1 }];
    expect(findPath(edges, 'x', 'z')).toBeNull();
  });
});
