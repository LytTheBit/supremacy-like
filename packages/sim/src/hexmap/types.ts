import type { ProvinceDef, ProvinceId } from '../types';

/**
 * Data model of a hexagonal map.
 *
 * Players never see the hexes: they are only used to shape provinces and to let
 * anyone draw a map. The game itself runs on the province graph (MapDef), which is
 * derived from this data by toMapDef().
 *
 * Everything is plain JSON, so a map can be saved, shared and edited.
 */

export type CellKind = 'land' | 'sea';

export interface HexCell {
  q: number;
  r: number;
  kind: CellKind;
  /** Province owning this cell. Always set on land cells, always null on sea cells. */
  province: ProvinceId | null;
}

/**
 * A manual connection between two provinces that do not touch (a strait, a ferry
 * route, a mountain pass). Adjacent provinces are linked automatically.
 */
export interface HexLink {
  a: ProvinceId;
  b: ProvinceId;
  /** Travel distance. When omitted it is computed from the distance between the provinces. */
  distance?: number;
}

export interface HexMapData {
  id: string;
  cells: HexCell[];
  provinces: ProvinceDef[];
  links: HexLink[];
}

export interface BorderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Province on one side of the segment. */
  a: ProvinceId;
  /** Province on the other side, or null for a coastline (sea or outside the map). */
  b: ProvinceId | null;
}
