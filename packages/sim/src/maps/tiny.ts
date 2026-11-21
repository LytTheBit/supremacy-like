import type { MapDef } from '../types';

/**
 * Five provinces, two capitals and a neutral center:
 *
 *   redhaven --2-- westmark --2-- midfield --2-- eastmark --2-- bluehaven
 *                     |_____________3_______________|
 *
 * The westmark-eastmark shortcut (3) is faster than going through midfield (4).
 */
export const tinyMap: MapDef = {
  id: 'tiny',
  provinces: [
    { id: 'redhaven', name: 'Redhaven', resource: 'grain', production: 3000 },
    { id: 'westmark', name: 'Westmark', resource: 'iron', production: 2000 },
    { id: 'midfield', name: 'Midfield', resource: 'coal', production: 2000 },
    { id: 'eastmark', name: 'Eastmark', resource: 'wood', production: 2000 },
    { id: 'bluehaven', name: 'Bluehaven', resource: 'grain', production: 3000 },
  ],
  edges: [
    { a: 'redhaven', b: 'westmark', distance: 2 },
    { a: 'westmark', b: 'midfield', distance: 2 },
    { a: 'midfield', b: 'eastmark', distance: 2 },
    { a: 'eastmark', b: 'bluehaven', distance: 2 },
    { a: 'westmark', b: 'eastmark', distance: 3 },
  ],
};
