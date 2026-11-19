import { adjacentProvincePairs, provinceAnchors } from './graph';
import { extractBorders } from './borders';
import { hexCorners, hexToPixel } from './hex';
import type { HexMapData } from './types';

export interface SvgOptions {
  /** Hex size in pixels (center to corner). Default 12. */
  size?: number;
  /** Draw province ids at their anchor cell. Default true. */
  showLabels?: boolean;
  /** Draw the province graph on top: adjacency as thin lines, manual links in red. Default false. */
  showGraph?: boolean;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Province colors: golden-angle hues so neighbors rarely look alike. Plain hex, valid everywhere. */
function provinceColor(index: number): string {
  const hue = (index * 137.508) % 360;
  const lightness = 0.62 + ((index * 7) % 3) * 0.05;
  return hslToHex(hue, 0.55, lightness);
}

/** Renders a hex map as a standalone SVG string (a quick preview for tools and tests). */
export function renderSvg(map: HexMapData, options: SvgOptions = {}): string {
  const size = options.size ?? 12;
  const showLabels = options.showLabels ?? true;
  const showGraph = options.showGraph ?? false;

  const colors = new Map(map.provinces.map((p, i) => [p.id, provinceColor(i)]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polygons: string[] = [];

  for (const cell of map.cells) {
    const corners = hexCorners(cell, size);
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
    const fill = cell.kind === 'land' && cell.province ? (colors.get(cell.province) ?? '#bbb') : '#cfe3f0';
    const points = corners.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    polygons.push(`<polygon points="${points}" fill="${fill}" stroke="${fill}" stroke-width="0.6"/>`);
  }
  if (!Number.isFinite(minX)) return '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>';

  const margin = size;
  const lines: string[] = [];
  for (const s of extractBorders(map, size)) {
    const coast = s.b === null;
    lines.push(
      `<line x1="${s.x1.toFixed(1)}" y1="${s.y1.toFixed(1)}" x2="${s.x2.toFixed(1)}" y2="${s.y2.toFixed(1)}" ` +
        `stroke="${coast ? '#3b4a54' : '#ffffff'}" stroke-width="${coast ? 1.6 : 2.2}" stroke-linecap="round"/>`,
    );
  }

  const anchors = provinceAnchors(map);
  const overlay: string[] = [];
  if (showGraph) {
    const point = (id: string) => {
      const hex = anchors.get(id);
      return hex ? hexToPixel(hex, size) : null;
    };
    const adjacent = new Set(adjacentProvincePairs(map).map(([a, b]) => `${a}|${b}`));
    for (const [a, b] of adjacentProvincePairs(map)) {
      const pa = point(a);
      const pb = point(b);
      if (pa && pb) {
        overlay.push(
          `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="#222" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`,
        );
      }
    }
    for (const link of map.links) {
      const key = link.a < link.b ? `${link.a}|${link.b}` : `${link.b}|${link.a}`;
      if (adjacent.has(key)) continue;
      const pa = point(link.a);
      const pb = point(link.b);
      if (pa && pb) {
        overlay.push(
          `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 4"/>`,
        );
      }
    }
    for (const id of anchors.keys()) {
      const p = point(id);
      if (p) overlay.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(size * 0.28).toFixed(1)}" fill="#222"/>`);
    }
  }
  if (showLabels) {
    for (const [id, hex] of anchors) {
      const p = hexToPixel(hex, size);
      overlay.push(
        `<text x="${p.x.toFixed(1)}" y="${(p.y - size * 0.55).toFixed(1)}" text-anchor="middle" font-family="sans-serif" ` +
          `font-size="${(size * 0.85).toFixed(1)}" font-weight="600" fill="#1c1c1c">${escapeXml(id)}</text>`,
      );
    }
  }

  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(minX - margin).toFixed(1)} ${(minY - margin).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" ` +
    `width="${width.toFixed(0)}" height="${height.toFixed(0)}">\n` +
    `<rect x="${(minX - margin).toFixed(1)}" y="${(minY - margin).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="#cfe3f0"/>\n` +
    `${polygons.join('\n')}\n${lines.join('\n')}\n${overlay.join('\n')}\n</svg>\n`
  );
}
