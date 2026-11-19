/**
 * Hexagonal grid utilities (axial coordinates, pointy-top layout).
 *
 * Neighbor directions are listed in the same order as the hexagon edges:
 * edge i connects corner i and corner i + 1, and faces HEX_DIRECTIONS[i].
 * Screen coordinates have y pointing down.
 */

export interface Hex {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, // east
  { q: 0, r: 1 }, // south-east
  { q: -1, r: 1 }, // south-west
  { q: -1, r: 0 }, // west
  { q: 0, r: -1 }, // north-west
  { q: 1, r: -1 }, // north-east
];

export const SQRT3 = Math.sqrt(3);

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** Number of steps between two hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** Center of a hex in pixels. `size` is the distance from center to corner. */
export function hexToPixel(h: Hex, size = 1): Point {
  return {
    x: size * SQRT3 * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** The hex containing a pixel position (inverse of hexToPixel). */
export function pixelToHex(x: number, y: number, size = 1): Hex {
  const qf = ((SQRT3 / 3) * x - y / 3) / size;
  const rf = ((2 / 3) * y) / size;
  return roundHex(qf, rf);
}

function roundHex(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Avoid -0 so keys stay stable.
  return { q: q + 0, r: r + 0 };
}

/** The six corners of a hex, in order. Edge i goes from corner i to corner i + 1. */
export function hexCorners(h: Hex, size = 1): Point[] {
  const center = hexToPixel(h, size);
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
  });
}
