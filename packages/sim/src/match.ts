import { runAi } from './ai';
import { tick } from './tick';
import type { GameState, PlayerId, Ruleset } from './types';

export interface MatchOptions {
  /** Players controlled by the AI. Everyone else is left to external orders. */
  aiPlayers: PlayerId[];
  /** Hard stop, in case nobody can win. */
  maxTicks: number;
  /** The AI plays every N ticks (default 1). */
  aiInterval?: number;
  /** Called after every tick, e.g. to log events. */
  onTick?: (state: GameState) => void;
}

/** Runs a game headless until it has an outcome or maxTicks is reached. */
export function runMatch(initial: GameState, rules: Ruleset, options: MatchOptions): GameState {
  const interval = Math.max(1, options.aiInterval ?? 1);
  let state = initial;

  while (!state.outcome && state.tick < options.maxTicks) {
    if (state.tick % interval === 0) {
      for (const playerId of options.aiPlayers) {
        state = runAi(state, rules, playerId);
      }
    }
    state = tick(state, rules);
    options.onTick?.(state);
  }
  return state;
}
