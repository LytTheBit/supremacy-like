import type { BuildingDef, BuildingId, BuildingUpgrade, Province, Ruleset, UnitDef, UnitTypeId } from './types';

/**
 * Buildings have levels. The def describes level 1 and `upgrades` the levels above it; the level a
 * province has is `province.buildingLevels[type]` (missing = 1). Effects are looked up per level, and an
 * effect an upgrade does not state is inherited from the level below.
 */

export function hasBuilding(province: Province, type: BuildingId): boolean {
  return province.buildings.includes(type);
}

/** Level of a building in a province: 0 when it is not there, 1 by default. */
export function buildingLevel(province: Pick<Province, 'buildings' | 'buildingLevels'>, type: BuildingId): number {
  if (!province.buildings.includes(type)) return 0;
  return province.buildingLevels?.[type] ?? 1;
}

/** Sets the level of a building that stands in the province (level 1 is stored as "nothing"). */
export function setBuildingLevel(province: Province, type: BuildingId, level: number): void {
  if (level <= 1) {
    if (province.buildingLevels) {
      delete province.buildingLevels[type];
      if (Object.keys(province.buildingLevels).length === 0) delete province.buildingLevels;
    }
    return;
  }
  province.buildingLevels = { ...province.buildingLevels, [type]: level };
}

/** Takes a building out of a province, with its level. */
export function removeBuilding(province: Province, type: BuildingId): void {
  province.buildings = province.buildings.filter((b) => b !== type);
  setBuildingLevel(province, type, 1);
}

/** Highest level a building can reach. */
export function maxBuildingLevel(def: BuildingDef): number {
  return 1 + (def.upgrades?.length ?? 0);
}

/** What it takes to build `level` (1 = the building itself, 2 and up = upgrades). Null above the top level. */
export function buildingStep(
  def: BuildingDef,
  level: number,
): { cost: Record<string, number>; buildTicks: number; requires: Record<BuildingId, number> } | null {
  if (level < 1 || level > maxBuildingLevel(def)) return null;
  if (level === 1) return { cost: def.cost, buildTicks: def.buildTicks, requires: def.requires ?? {} };
  const upgrade = def.upgrades?.[level - 2] as BuildingUpgrade;
  return { cost: upgrade.cost, buildTicks: upgrade.buildTicks, requires: upgrade.requires ?? def.requires ?? {} };
}

type LevelEffect = 'productionMultiplier' | 'trainingTimeMultiplier' | 'damageReduction';

/** An effect of a building at a level, inherited from the levels below when an upgrade does not state it. */
export function levelEffect(def: BuildingDef, level: number, effect: LevelEffect): number | undefined {
  for (let l = Math.min(level, maxBuildingLevel(def)); l >= 2; l--) {
    const value = def.upgrades?.[l - 2]?.[effect];
    if (value !== undefined) return value;
  }
  return def[effect];
}

/** Product of the production multipliers of all buildings in the province. */
export function productionMultiplier(rules: Ruleset, province: Province): number {
  let multiplier = 1;
  for (const type of province.buildings) {
    const def = rules.buildings[type];
    if (def) multiplier *= levelEffect(def, buildingLevel(province, type), 'productionMultiplier') ?? 1;
  }
  return multiplier;
}

/** Product of the training-time multipliers of all buildings in the province. */
export function trainingTimeMultiplier(rules: Ruleset, province: Province): number {
  let multiplier = 1;
  for (const type of province.buildings) {
    const def = rules.buildings[type];
    if (def) multiplier *= levelEffect(def, buildingLevel(province, type), 'trainingTimeMultiplier') ?? 1;
  }
  return multiplier;
}

/** Share of the damage the buildings of the province stop (the best one counts). */
export function damageReduction(rules: Ruleset, province: Province): number {
  let best = 0;
  for (const type of province.buildings) {
    const def = rules.buildings[type];
    if (def) best = Math.max(best, levelEffect(def, buildingLevel(province, type), 'damageReduction') ?? 0);
  }
  return Math.min(best, 1);
}

/** The requirements of a unit as [building, minimum level] pairs, sorted by building. */
export function unitRequirements(def: Pick<UnitDef, 'requires'>): [BuildingId, number][] {
  return Object.entries(def.requires ?? {}).sort((x, y) => x[0].localeCompare(y[0]));
}

/** The first requirement of a unit that the province does not meet, or null when it can train it. */
export function missingUnitRequirement(
  province: Pick<Province, 'buildings' | 'buildingLevels'>,
  def: Pick<UnitDef, 'requires'>,
): [BuildingId, number] | null {
  for (const [building, level] of unitRequirements(def)) {
    if (buildingLevel(province, building) < level) return [building, level];
  }
  return null;
}

/** The first prerequisite of a build step that the province does not meet, or null. */
export function missingBuildingRequirement(
  province: Pick<Province, 'buildings' | 'buildingLevels'>,
  requires: Record<BuildingId, number>,
): [BuildingId, number] | null {
  return missingUnitRequirement(province, { requires });
}

/** Training time of a unit in a given province, never below one tick. */
export function effectiveTrainingTicks(rules: Ruleset, province: Province, unitType: UnitTypeId): number {
  const def = rules.units[unitType];
  if (!def) throw new Error(`Unknown unit type: ${unitType}`);
  // The small epsilon protects against float noise such as 2 * 0.5 * 1.0000000000000002.
  return Math.max(1, Math.ceil(def.trainingTicks * trainingTimeMultiplier(rules, province) - 1e-9));
}
