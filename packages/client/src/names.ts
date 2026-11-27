import { mulberry32 } from '@supremacy/sim';

const NAMES = [
  'Aldora', 'Brenna', 'Calvera', 'Dorsten', 'Elmira', 'Falken', 'Garrow', 'Hallund', 'Istria', 'Jorvik',
  'Kestrel', 'Lorien', 'Marsa', 'Norwick', 'Ostara', 'Pellen', 'Quillon', 'Rovena', 'Stavik', 'Thalia',
  'Umbria', 'Valdor', 'Wexford', 'Xanten', 'Ysolde', 'Zelmar', 'Arvik', 'Bressa', 'Cardon', 'Dunmere',
  'Esker', 'Fenwick', 'Glaston', 'Harrow', 'Ilmar', 'Jura', 'Kolven', 'Lysa', 'Morrow', 'Nordin',
];

/**
 * Distinct, deterministic province names for a seed (proper nouns: they are not translated).
 * Past the end of the list the entries are null: the interface then shows a numbered,
 * translated name ("Province 41").
 */
export function provinceNames(count: number, seed: number): (string | null)[] {
  const rng = mulberry32(seed + 4242);
  const pool = [...NAMES];
  // Fisher-Yates shuffle with the seeded generator.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return Array.from({ length: count }, (_, i) => pool[i] ?? null);
}
