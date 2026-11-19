import type { GameState, Ruleset } from './types';

/**
 * Checks eliminations and victory at the end of a tick. Mutates the given state,
 * which is always the private copy created by tick().
 *
 * - A player is eliminated when they have no provinces, no armies and no
 *   recruit batches in training.
 * - Last standing: with two or more players in the game, the only survivor wins.
 * - Domination: a survivor owning at least `rules.victory.provinceShare`
 *   of ALL provinces wins.
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
    finish(state, null, 'extinction');
    return;
  }

  const [onlySurvivor] = survivors;
  if (survivors.length === 1 && state.players.length > 1 && onlySurvivor) {
    finish(state, onlySurvivor.id, 'last_standing');
    return;
  }

  const needed = Math.ceil(rules.victory.provinceShare * state.provinces.length);
  const ranked = [...survivors].sort((x, y) => x.id.localeCompare(y.id));
  for (const player of ranked) {
    const owned = state.provinces.filter((p) => p.owner === player.id).length;
    if (owned >= needed) {
      finish(state, player.id, 'domination');
      return;
    }
  }
}

function finish(
  state: GameState,
  winner: string | null,
  reason: 'domination' | 'last_standing' | 'extinction',
): void {
  state.outcome = { winner, reason };
  state.events.push({ tick: state.tick, type: 'game_over', winner, reason });
}
