import type { Bundle, Medal, Player, Ruleset } from '@supremacy/sim';
import { formatAmount } from './format';
import { t, tOr } from './i18n';

/**
 * Display names of things that come from the game data. Each has a translation key built from
 * its id; when there is none (a new unit in the rules, a modded medal) the English name stored
 * in the data is shown, so the interface never breaks on new content.
 */

export function resourceName(id: string): string {
  return tOr(`resource.${id}`, id);
}

export function unitName(rules: Ruleset, id: string): string {
  return tOr(`unit.${id}`, rules.units[id]?.name ?? id);
}

export function buildingName(rules: Ruleset, id: string): string {
  return tOr(`building.${id}`, rules.buildings[id]?.name ?? id);
}

/** "Barracks 2": the name of a building with its level (no number for level 1). */
export function buildingLabel(rules: Ruleset, id: string, level: number): string {
  const name = buildingName(rules, id);
  return level > 1 ? t('building.level', { building: name, level }) : name;
}

/** A short mark for the map: two letters of the name and the level above 1, like "Ba2". */
export function buildingGlyph(rules: Ruleset, id: string, level: number): string {
  const name = buildingName(rules, id);
  return `${name.charAt(0).toUpperCase()}${name.charAt(1).toLowerCase()}${level > 1 ? level : ''}`;
}

export function medalName(medal: Pick<Medal, 'id' | 'name'>): string {
  return tOr(`medal.${medal.id}.name`, medal.name);
}

export function medalDescription(medal: Pick<Medal, 'id' | 'description'>): string {
  return tOr(`medal.${medal.id}.description`, medal.description);
}

/** The name of a player: translated for the two built-in sides, as stored for any other. */
export function playerName(players: Pick<Player, 'id' | 'name'>[], id: string | null): string {
  if (id === null) return t('player.nobody');
  const player = players.find((p) => p.id === id);
  return tOr(`player.${id}`, player?.name ?? id);
}

/** The text for the error code of a failed order. */
export function errorText(code: string): string {
  return tOr(`error.${code}`, code);
}

/** A price: "2.0k Grain, 1.0k Iron", or "free". */
export function formatCost(cost: Record<string, number>): string {
  const parts = Object.entries(cost)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${formatAmount(amount)} ${resourceName(resource)}`);
  return parts.length > 0 ? parts.join(', ') : t('format.free');
}

/**
 * What a bundle holds: "5.0k Money, 2.0k Grain, Marikina". `provinceName` writes a province in the
 * current language. An empty bundle reads "nothing".
 */
export function formatBundle(bundle: Bundle, provinceName: (id: string) => string): string {
  const parts = Object.entries(bundle.resources)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${formatAmount(amount)} ${resourceName(resource)}`);
  for (const id of bundle.provinces) parts.push(provinceName(id));
  return parts.length > 0 ? parts.join(', ') : t('format.nothing');
}
