import { mkdirSync, writeFileSync } from 'node:fs';
import {
  connectedGroups,
  generateHexMap,
  renderSvg,
  toMapDef,
  validateHexMap,
} from '../src';

// Usage: npm run genmap -- --seed 7 --provinces 24 --width 48 --height 32 --land 0.6 --roughness 1.2
function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const seed = arg('seed', 1);
const map = generateHexMap({
  seed,
  width: arg('width', 48),
  height: arg('height', 32),
  provinceCount: arg('provinces', 24),
  landRatio: arg('land', 0.6),
  roughness: arg('roughness', 1.2),
});

const issues = validateHexMap(map);
const mapDef = toMapDef(map);
const land = map.cells.filter((c) => c.kind === 'land').length;

console.log(`Map "${map.id}": ${map.cells.length} cells, ${land} land, ${map.provinces.length} provinces`);
console.log(`Graph: ${mapDef.edges.length} edges, ${map.links.length} sea links, ${connectedGroups(map).length} group(s)`);
console.log(issues.length === 0 ? 'Validation: OK' : `Validation issues:\n${issues.map((i) => `  - ${i.message}`).join('\n')}`);

mkdirSync('out', { recursive: true });
writeFileSync(`out/map-${seed}.json`, JSON.stringify(map));
writeFileSync(`out/mapdef-${seed}.json`, JSON.stringify(mapDef, null, 2));
writeFileSync(`out/map-${seed}.svg`, renderSvg(map, { showGraph: true }));
console.log(`Written out/map-${seed}.svg, out/map-${seed}.json, out/mapdef-${seed}.json`);
