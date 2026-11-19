import { hexKey, hexNeighbors } from './hex';
import { buildCellIndex, cellsByProvince, connectedGroups } from './graph';
import type { HexMapData } from './types';

export type HexMapIssueCode =
  | 'duplicate_cell'
  | 'duplicate_province'
  | 'unknown_province'
  | 'land_without_province'
  | 'sea_with_province'
  | 'empty_province'
  | 'disconnected_province'
  | 'bad_link'
  | 'disconnected_map';

export interface HexMapIssue {
  code: HexMapIssueCode;
  message: string;
}

/** Checks a hex map and lists every problem found. An empty list means the map is valid. */
export function validateHexMap(map: HexMapData): HexMapIssue[] {
  const issues: HexMapIssue[] = [];
  const add = (code: HexMapIssueCode, message: string) => issues.push({ code, message });

  const provinceIds = new Set<string>();
  for (const province of map.provinces) {
    if (provinceIds.has(province.id)) add('duplicate_province', `Duplicate province id: ${province.id}`);
    provinceIds.add(province.id);
  }

  const seenCells = new Set<string>();
  for (const cell of map.cells) {
    const key = hexKey(cell);
    if (seenCells.has(key)) add('duplicate_cell', `Duplicate cell at ${key}`);
    seenCells.add(key);

    if (cell.kind === 'land') {
      if (cell.province === null) add('land_without_province', `Land cell ${key} has no province`);
      else if (!provinceIds.has(cell.province)) {
        add('unknown_province', `Cell ${key} references unknown province ${cell.province}`);
      }
    } else if (cell.province !== null) {
      add('sea_with_province', `Sea cell ${key} belongs to province ${cell.province}`);
    }
  }

  const groups = cellsByProvince(map);
  const index = buildCellIndex(map);

  for (const province of map.provinces) {
    const cells = groups.get(province.id);
    if (!cells || cells.length === 0) {
      add('empty_province', `Province ${province.id} has no cells`);
      continue;
    }

    // Every province must be one connected piece (flood fill through its own cells).
    const own = new Set(cells.map(hexKey));
    const first = cells[0];
    if (!first) continue;
    const visited = new Set<string>([hexKey(first)]);
    const stack = [first];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      for (const n of hexNeighbors(current)) {
        const key = hexKey(n);
        const cell = index.get(key);
        if (cell && own.has(key) && !visited.has(key)) {
          visited.add(key);
          stack.push(cell);
        }
      }
    }
    if (visited.size !== own.size) {
      add('disconnected_province', `Province ${province.id} is split into several pieces`);
    }
  }

  for (const link of map.links) {
    if (!provinceIds.has(link.a) || !provinceIds.has(link.b) || link.a === link.b) {
      add('bad_link', `Link ${link.a}-${link.b} references unknown provinces`);
    } else if (link.distance !== undefined && link.distance <= 0) {
      add('bad_link', `Link ${link.a}-${link.b} must have a positive distance`);
    }
  }

  if (map.provinces.length > 0 && connectedGroups(map).length > 1) {
    add('disconnected_map', 'The map has groups of provinces that cannot reach each other');
  }

  return issues;
}
