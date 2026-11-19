import { HEX_DIRECTIONS, hexCorners, hexKey } from './hex';
import { buildCellIndex } from './graph';
import type { BorderSegment, HexMapData } from './types';

/**
 * Line segments that separate provinces from each other and from the sea.
 * Province borders are returned once; coastlines have `b === null`.
 * `size` is the hex size in pixels. Handy for drawing the map.
 */
export function extractBorders(map: HexMapData, size = 1): BorderSegment[] {
  const index = buildCellIndex(map);
  const segments: BorderSegment[] = [];

  for (const cell of map.cells) {
    if (cell.kind !== 'land' || cell.province === null) continue;
    const corners = hexCorners(cell, size);
    const provinceId = cell.province;

    HEX_DIRECTIONS.forEach((direction, i) => {
      const neighbor = index.get(hexKey({ q: cell.q + direction.q, r: cell.r + direction.r }));
      const other = neighbor && neighbor.kind === 'land' ? neighbor.province : null;
      if (other === provinceId) return;
      // A border between two provinces is seen from both sides: draw it from one only.
      if (other !== null && provinceId > other) return;

      const from = corners[i];
      const to = corners[(i + 1) % 6];
      if (!from || !to) return;
      segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, a: provinceId, b: other });
    });
  }
  return segments;
}
