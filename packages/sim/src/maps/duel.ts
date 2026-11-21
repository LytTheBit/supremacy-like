import type { MapDef } from '../types';

/**
 * A symmetric 12-province map for two players: five provinces each plus two
 * neutral ones in the middle. Domination at 60% means owning 8 of 12.
 *
 *   rcap - riron - rfront --3-- mnorth --3-- bfront - biron - bcap
 *     |                |           |             |                |
 *   rwood - rcoal ----+--3-- msouth --3-- bcoal --+- bwood -----+
 *
 * (rcoal also touches rfront, bcoal also touches bfront.)
 */
export const duelMap: MapDef = {
  id: 'duel',
  provinces: [
    { id: 'rcap', name: 'Red Capital', resource: 'grain', production: 3000 },
    { id: 'riron', name: 'Red Ironworks', resource: 'iron', production: 2000 },
    { id: 'rwood', name: 'Red Forest', resource: 'wood', production: 2000 },
    { id: 'rcoal', name: 'Red Coalfield', resource: 'coal', production: 2000 },
    { id: 'rfront', name: 'Red Frontier', resource: 'grain', production: 2000 },
    { id: 'mnorth', name: 'North Plains', resource: 'grain', production: 2000 },
    { id: 'msouth', name: 'South Hills', resource: 'iron', production: 2000 },
    { id: 'bfront', name: 'Blue Frontier', resource: 'grain', production: 2000 },
    { id: 'bcoal', name: 'Blue Coalfield', resource: 'coal', production: 2000 },
    { id: 'bwood', name: 'Blue Forest', resource: 'wood', production: 2000 },
    { id: 'biron', name: 'Blue Ironworks', resource: 'iron', production: 2000 },
    { id: 'bcap', name: 'Blue Capital', resource: 'grain', production: 3000 },
  ],
  edges: [
    { a: 'rcap', b: 'riron', distance: 2 },
    { a: 'rcap', b: 'rwood', distance: 2 },
    { a: 'riron', b: 'rfront', distance: 2 },
    { a: 'rwood', b: 'rcoal', distance: 2 },
    { a: 'rcoal', b: 'rfront', distance: 2 },
    { a: 'rfront', b: 'mnorth', distance: 3 },
    { a: 'rcoal', b: 'msouth', distance: 3 },
    { a: 'mnorth', b: 'msouth', distance: 2 },
    { a: 'mnorth', b: 'bfront', distance: 3 },
    { a: 'msouth', b: 'bcoal', distance: 3 },
    { a: 'bcap', b: 'biron', distance: 2 },
    { a: 'bcap', b: 'bwood', distance: 2 },
    { a: 'biron', b: 'bfront', distance: 2 },
    { a: 'bwood', b: 'bcoal', distance: 2 },
    { a: 'bcoal', b: 'bfront', distance: 2 },
  ],
};
