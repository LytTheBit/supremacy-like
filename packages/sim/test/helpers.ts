import type { GameState } from '../src';

/**
 * Gives every owned land province a recruitment office, which infantry needs. Many tests are about
 * something else and just want to recruit infantry wherever a player owns land.
 */
export function withOffices(state: GameState): GameState {
  for (const province of state.provinces) {
    if (province.owner !== null && !province.buildings.includes('recruitment_office')) {
      province.buildings.push('recruitment_office');
    }
  }
  return state;
}

/** Puts buildings with levels into a province, bypassing orders and prerequisites. */
export function giveBuildings(state: GameState, provinceId: string, levels: Record<string, number>): GameState {
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) throw new Error(`no province ${provinceId}`);
  for (const [type, level] of Object.entries(levels)) {
    if (!province.buildings.includes(type)) province.buildings.push(type);
    if (level > 1) province.buildingLevels = { ...province.buildingLevels, [type]: level };
  }
  return state;
}
