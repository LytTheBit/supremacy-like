import { areAllied } from './diplomacy';
import type { GameState, PlayerId, Ruleset, VictoryReason } from './types';

/**
 * Checks eliminations and victory at the end of a tick. Mutates the given state,
 * which is always the private copy created by tick().
 *
 * - A player is eliminated when they have no provinces, no armies and no
 *   recruit batches in training.
 * - Last standing: with two or more players in the game, the only survivor wins.
 * - Domination: a survivor owning at least `rules.victory.provinceShare`
 *   of ALL provinces wins.
 * - Coalition: a group of survivors that are ALL allied with each other wins together when
 *   the group together owns the domination share. Allying is never enough on its own: a lone
 *   survivor wins by last standing, but allies still have to reach the share.
 * - Extinction: if nobody is left, the game ends without a winner.
 */
export function checkVictory(state: GameState, rules: Ruleset): void {
  if (state.outcome) return;

  for (const player of state.players) {
    if (state.eliminated.includes(player.id)) continue;
    const stillInGame =
      state.provinces.some((p) => p.owner === player.id) ||
      state.armies.some((a) => a.owner === player.id) ||
      state.recruitQueue.some((j) => j.owner === player.id);
    if (!stillInGame) {
      state.eliminated.push(player.id);
      state.events.push({ tick: state.tick, type: 'player_eliminated', playerId: player.id });
    }
  }

  const survivors = state.players.filter((p) => !state.eliminated.includes(p.id));

  if (survivors.length === 0) {
    finish(state, [], 'extinction');
    return;
  }

  const groups = victoryGroups(state, survivors.map((p) => p.id).sort());

  const [onlySurvivor] = survivors;
  if (survivors.length === 1 && state.players.length > 1 && onlySurvivor) {
    finish(state, [onlySurvivor.id], 'last_standing');
    return;
  }

  const needed = Math.ceil(rules.victory.provinceShare * state.provinces.length);
  for (const group of groups) {
    const owned = state.provinces.filter((p) => p.owner !== null && group.includes(p.owner)).length;
    if (owned >= needed) {
      finish(state, group, group.length === 1 ? 'domination' : 'coalition');
      return;
    }
  }
}

/**
 * The groups that can win together: every survivor alone, plus every survivor with all the
 * survivors allied to them, as long as those are all allied with each other too.
 * Sorted by their first player, so the result is deterministic.
 */
function victoryGroups(state: GameState, survivors: PlayerId[]): PlayerId[][] {
  const seen = new Set<string>();
  const groups: PlayerId[][] = [];
  const add = (group: PlayerId[]) => {
    const sorted = [...group].sort();
    const key = sorted.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    groups.push(sorted);
  };

  for (const player of survivors) {
    add([player]);
    const friends = survivors.filter((other) => areAllied(state, player, other));
    const group = [player, ...friends];
    const cohesive = group.every((x) => group.every((y) => x === y || areAllied(state, x, y)));
    if (friends.length > 0 && cohesive) add(group);
  }
  // Larger groups first would let a coalition win before a player alone: keep singles first.
  return groups.sort((x, y) => x.length - y.length || (x[0] ?? '').localeCompare(y[0] ?? ''));
}

function finish(state: GameState, winners: PlayerId[], reason: VictoryReason): void {
  const winner = winners[0] ?? null;
  state.outcome = { winner, winners, reason };
  state.events.push({ tick: state.tick, type: 'game_over', winner, winners, reason });
}
