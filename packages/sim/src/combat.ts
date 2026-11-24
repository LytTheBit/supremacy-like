import type { Ruleset, UnitDomain, Units } from './types';
import { splitByDomain } from './naval';

/**
 * Simplified combat model (no randomness, no external calculator needed).
 *
 * Each round, for a side X attacked by a side Y:
 *   damage(Y -> X) = attack(Y) * attack(Y) / (attack(Y) + defense(X)) * damageScale
 * Damage is split evenly between all enemy sides, then converted to a
 * survival factor: survival = 1 - incomingDamage / totalHp(X).
 * All units of a side lose the same share, so the army shrinks smoothly.
 *
 * Because attack appears both as the base and in the ratio, bigger armies
 * gain a disproportionate advantage (Lanchester-like square law).
 */

export interface SideStats {
  attack: number;
  defense: number;
  hp: number;
}

export function totalCount(units: Units): number {
  return Object.values(units).reduce((sum, n) => sum + n, 0);
}

/**
 * Attack and defense bonus (0.2 = +20%) that the commanders of an army give to its troops.
 * Each commander type contributes `bonus * count`, capped by its own `maxBonus`.
 * Commanders alone lead nobody, and `commanders.maxAffectedTroops` (if set) limits how
 * many troops benefit: the bonus is then scaled by the share of troops it reaches.
 */
export function commanderBonus(rules: Ruleset, units: Units): number {
  let bonus = 0;
  let troops = 0;
  for (const [type, count] of Object.entries(units)) {
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    if (def.commander) bonus += Math.min(def.commander.maxBonus, def.commander.bonus * count);
    else troops += count;
  }
  if (bonus <= 0 || troops <= 0) return 0;

  const limit = rules.commanders?.maxAffectedTroops;
  const share = limit === undefined ? 1 : Math.min(1, limit / troops);
  return bonus * share;
}

export function sideStats(rules: Ruleset, units: Units): SideStats {
  const stats: SideStats = { attack: 0, defense: 0, hp: 0 };
  for (const [type, count] of Object.entries(units)) {
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    stats.attack += def.attack * count;
    stats.defense += def.defense * count;
    stats.hp += def.hp * count;
  }
  // Commanders raise attack and defense, not hit points.
  const multiplier = 1 + commanderBonus(rules, units);
  stats.attack *= multiplier;
  stats.defense *= multiplier;
  return stats;
}

/**
 * Attack of a side against a particular enemy side. Units with `vs` multipliers (bombers,
 * fighters, infantry against aircraft...) are weighted by the share of the enemy's units in each
 * domain. Without any `vs` this is exactly sideStats().attack.
 */
export function attackAgainst(rules: Ruleset, attacker: Units, target: Units): number {
  const parts = splitByDomain(rules, target);
  const counts = {
    land: totalCount(parts.land),
    sea: totalCount(parts.sea),
    air: totalCount(parts.air),
  };
  const all = counts.land + counts.sea + counts.air;

  let attack = 0;
  for (const [type, count] of Object.entries(attacker)) {
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    let factor = 1;
    if (def.vs && all > 0) {
      factor = 0;
      for (const domain of ['land', 'sea', 'air'] as UnitDomain[]) {
        factor += (counts[domain] / all) * (def.vs[domain] ?? 1);
      }
    }
    attack += def.attack * count * factor;
  }
  return attack * (1 + commanderBonus(rules, attacker));
}

/** Shelling power of a fleet: the sum of `bombard` over its ships. 0 if none of them can bombard. */
export function bombardPower(rules: Ruleset, units: Units): number {
  let power = 0;
  for (const [type, count] of Object.entries(units)) {
    if (count <= 0) continue;
    const def = rules.units[type];
    if (!def) throw new Error(`Unknown unit type: ${type}`);
    power += (def.bombard ?? 0) * count;
  }
  return power;
}

/**
 * Survival factor (0..1) of a force that is shelled for one tick with the given power. One-sided:
 * same damage formula as a battle round, but the target does not shoot back.
 */
export function shellingSurvival(rules: Ruleset, power: number, target: Units): number {
  const stats = sideStats(rules, target);
  if (power <= 0 || stats.hp <= 0) return 1;
  const damage = ((power * power) / (power + stats.defense)) * rules.combat.damageScale;
  const survival = Math.max(0, 1 - damage / stats.hp);
  return totalCount(target) * survival < rules.combat.minUnitsAlive ? 0 : survival;
}

/** Multiplies all counts by a factor. A factor <= 0 wipes the army out. */
export function scaleUnits(units: Units, factor: number): Units {
  if (factor <= 0) return {};
  const scaled: Units = {};
  for (const [type, count] of Object.entries(units)) {
    scaled[type] = count * factor;
  }
  return scaled;
}

/** Sums several unit sets into one. */
export function sumUnits(list: Units[]): Units {
  const total: Units = {};
  for (const units of list) {
    for (const [type, count] of Object.entries(units)) {
      total[type] = (total[type] ?? 0) + count;
    }
  }
  return total;
}

/**
 * Resolves one combat round between two or more sides.
 * Returns the survival factor (0..1) of each side, in the same order.
 * All damage is computed from the state at the start of the round (simultaneous).
 *
 * By default every side fights every other side. `hostile(i, j)` can say which pairs fight
 * (allies stand side by side): a side's damage is split evenly between the sides it fights,
 * and a side nobody fights comes out untouched.
 */
export function resolveRound(
  rules: Ruleset,
  sides: Units[],
  hostile: (i: number, j: number) => boolean = () => true,
): number[] {
  const stats = sides.map((units) => sideStats(rules, units));
  const enemyCount = stats.map((_, i) => stats.filter((__, j) => j !== i && hostile(i, j)).length);

  return stats.map((target, i) => {
    if (target.hp <= 0) return 0;
    if ((enemyCount[i] ?? 0) <= 0) return 1;

    let incoming = 0;
    stats.forEach((attacker, j) => {
      if (i === j || attacker.attack <= 0 || !hostile(j, i)) return;
      const attack = attackAgainst(rules, sides[j] ?? {}, sides[i] ?? {});
      if (attack <= 0) return;
      const damage = ((attack * attack) / (attack + target.defense)) * rules.combat.damageScale;
      incoming += damage / (enemyCount[j] ?? 1);
    });

    const survival = Math.max(0, 1 - incoming / target.hp);
    const unitsLeft = totalCount(sides[i] ?? {}) * survival;
    return unitsLeft < rules.combat.minUnitsAlive ? 0 : survival;
  });
}

export interface BattlePreview {
  winner: 'attacker' | 'defender' | 'draw' | 'stalemate';
  rounds: number;
  attackerLeft: Units;
  defenderLeft: Units;
  /** Fraction (0..1) of the original hit points still alive. */
  attackerHpLeft: number;
  defenderHpLeft: number;
}

/**
 * Plays a full battle between two unit sets and reports the outcome.
 * This is the "built-in calculator" the UI can show before confirming an attack.
 * Note: the model is symmetric, so "attacker" and "defender" are only labels
 * (terrain, morale and generals will add modifiers later).
 */
export function previewBattle(
  rules: Ruleset,
  attacker: Units,
  defender: Units,
  maxRounds = 1000,
): BattlePreview {
  const attackerHp = sideStats(rules, attacker).hp;
  const defenderHp = sideStats(rules, defender).hp;

  let a = attacker;
  let d = defender;
  let rounds = 0;
  let stalemate = false;

  while (rounds < maxRounds && totalCount(a) > 0 && totalCount(d) > 0) {
    const { attack: attackA } = sideStats(rules, a);
    const { attack: attackD } = sideStats(rules, d);
    if (attackA <= 0 && attackD <= 0) {
      stalemate = true;
      break;
    }
    const [factorA = 0, factorD = 0] = resolveRound(rules, [a, d]);
    a = scaleUnits(a, factorA);
    d = scaleUnits(d, factorD);
    rounds += 1;
  }

  const aAlive = totalCount(a) > 0;
  const dAlive = totalCount(d) > 0;
  let winner: BattlePreview['winner'];
  if (stalemate || (aAlive && dAlive)) winner = 'stalemate';
  else if (aAlive) winner = 'attacker';
  else if (dAlive) winner = 'defender';
  else winner = 'draw';

  return {
    winner,
    rounds,
    attackerLeft: a,
    defenderLeft: d,
    attackerHpLeft: attackerHp > 0 ? sideStats(rules, a).hp / attackerHp : 0,
    defenderHpLeft: defenderHp > 0 ? sideStats(rules, d).hp / defenderHp : 0,
  };
}
