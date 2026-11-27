import { postDirect, setOfferStatus } from './chat';
import type {
  GameState,
  PlayerId,
  Proposal,
  RelationStatus,
  Relationship,
  Ruleset,
  TreatyKind,
} from './types';

/**
 * Diplomacy between players.
 *
 * Two players with no treaty are at war (the start of every game). A treaty is either a
 * truce (temporary: the war resumes when it runs out) or an alliance (it lasts until one
 * side declares war). Only players at war fight each other and conquer each other's
 * provinces; truce partners and allies can share a province without fighting.
 *
 * Players talk through proposals: one player offers a treaty, the other accepts or
 * rejects it. Breaking a treaty needs a notice (`rules.diplomacy.warNoticeTicks`) so the
 * other side gets time to react. All orders are pure: the input state is never modified.
 */

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function samePair(r: Relationship, a: PlayerId, b: PlayerId): boolean {
  return (r.a === a && r.b === b) || (r.a === b && r.b === a);
}

/** The treaty in force between two players, or null when they are at war. */
export function findRelationship(state: GameState, a: PlayerId, b: PlayerId): Relationship | null {
  return state.relations.find((r) => samePair(r, a, b)) ?? null;
}

/** War, truce or alliance between two different players. */
export function relationBetween(state: GameState, a: PlayerId, b: PlayerId): RelationStatus {
  return findRelationship(state, a, b)?.kind ?? 'war';
}

/** True when the two players fight each other. A player is never hostile to themselves. */
export function areHostile(state: GameState, a: PlayerId, b: PlayerId): boolean {
  return a !== b && relationBetween(state, a, b) === 'war';
}

export function areAllied(state: GameState, a: PlayerId, b: PlayerId): boolean {
  return a !== b && relationBetween(state, a, b) === 'alliance';
}

/** Players allied with the given one, sorted by id. */
export function alliesOf(state: GameState, playerId: PlayerId): PlayerId[] {
  return state.relations
    .filter((r) => r.kind === 'alliance' && (r.a === playerId || r.b === playerId))
    .map((r) => (r.a === playerId ? r.b : r.a))
    .sort();
}

/** Proposals waiting for an answer from this player. */
export function proposalsFor(state: GameState, playerId: PlayerId): Proposal[] {
  return state.proposals.filter((p) => p.to === playerId);
}

/** True if the player has already offered this kind of treaty to the other and is waiting. */
export function hasPendingProposal(state: GameState, from: PlayerId, to: PlayerId, kind?: TreatyKind): boolean {
  return state.proposals.some((p) => p.from === from && p.to === to && (kind === undefined || p.kind === kind));
}

function pairOf(a: PlayerId, b: PlayerId): [PlayerId, PlayerId] {
  return a < b ? [a, b] : [b, a];
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type DiplomacyError =
  | 'game_over'
  | 'player_not_found'
  | 'same_player'
  | 'player_eliminated'
  | 'already_allied'
  | 'already_at_war'
  | 'war_pending'
  | 'already_proposed'
  | 'proposal_not_found'
  | 'not_recipient';

export type DiplomacyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: DiplomacyError };

/**
 * Events caused by an order are stamped with the tick in which they take effect (the next
 * one), so tick() can tell them apart from the events of the previous tick and keeps them.
 */
function orderTick(state: GameState): number {
  return state.tick + 1;
}

/**
 * Offers a treaty to another player.
 * - A truce can be offered while at war, or during a truce to extend it.
 * - An alliance can be offered while at war or in a truce.
 * - Nothing can be offered while a declaration of war is pending, or to an eliminated player.
 */
export function orderPropose(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  target: PlayerId,
  kind: TreatyKind,
): DiplomacyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  if (!state.players.some((p) => p.id === playerId) || !state.players.some((p) => p.id === target)) {
    return { ok: false, error: 'player_not_found' };
  }
  if (playerId === target) return { ok: false, error: 'same_player' };
  if (state.eliminated.includes(playerId) || state.eliminated.includes(target)) {
    return { ok: false, error: 'player_eliminated' };
  }

  const relation = findRelationship(state, playerId, target);
  if (relation?.warAt !== undefined) return { ok: false, error: 'war_pending' };
  if (relation?.kind === 'alliance') return { ok: false, error: 'already_allied' };
  if (state.proposals.some((p) => p.kind === kind && ((p.from === playerId && p.to === target) || (p.from === target && p.to === playerId)))) {
    return { ok: false, error: 'already_proposed' };
  }

  const next = structuredClone(state);
  const proposal: Proposal = {
    id: `prop-${next.nextId}`,
    from: playerId,
    to: target,
    kind,
    expiresAt: next.tick + rules.diplomacy.proposalTicks,
  };
  next.nextId += 1;
  next.proposals.push(proposal);
  next.events.push({ tick: orderTick(next), type: 'proposal_made', proposalId: proposal.id, from: playerId, to: target, kind });
  postDirect(next, playerId, target, playerId, { kind: 'treaty', proposalId: proposal.id, treaty: kind, status: 'open' }, rules);
  return { ok: true, state: next };
}

/**
 * Answers a proposal made to the player. Accepting signs the treaty; rejecting withdraws
 * the offer. Either way the proposal is removed.
 */
export function orderRespond(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  proposalId: string,
  accept: boolean,
): DiplomacyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const proposal = state.proposals.find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, error: 'proposal_not_found' };
  if (proposal.to !== playerId) return { ok: false, error: 'not_recipient' };

  const next = structuredClone(state);
  next.proposals = next.proposals.filter((p) => p.id !== proposalId);
  const { from, to, kind } = proposal;

  if (!accept) {
    setOfferStatus(next, proposalId, 'rejected');
    next.events.push({ tick: orderTick(next), type: 'proposal_rejected', proposalId, from, to, kind });
    return { ok: true, state: next };
  }

  // An eliminated player can no longer sign anything.
  if (next.eliminated.includes(from) || next.eliminated.includes(to)) return { ok: false, error: 'player_eliminated' };
  // Things may have changed since the offer was made: never downgrade an alliance to a truce.
  const current = findRelationship(next, from, to);
  if (current?.kind === 'alliance') return { ok: false, error: 'already_allied' };
  if (current?.warAt !== undefined) return { ok: false, error: 'war_pending' };

  signTreaty(next, rules, from, to, kind);
  setOfferStatus(next, proposalId, 'accepted');
  next.events.push({ tick: orderTick(next), type: 'proposal_accepted', proposalId, from, to, kind });
  next.events.push({ tick: orderTick(next), type: 'relation_changed', a: pairOf(from, to)[0], b: pairOf(from, to)[1], status: kind, reason: 'treaty' });
  return { ok: true, state: next };
}

/**
 * Declares war on a player. Against someone we are already fighting nothing changes (error).
 * Against a truce partner or an ally the war starts after `warNoticeTicks`; during the
 * notice the treaty still protects both sides. With a notice of 0 the war starts at once.
 */
export function orderDeclareWar(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  target: PlayerId,
): DiplomacyResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  if (!state.players.some((p) => p.id === playerId) || !state.players.some((p) => p.id === target)) {
    return { ok: false, error: 'player_not_found' };
  }
  if (playerId === target) return { ok: false, error: 'same_player' };

  const relation = findRelationship(state, playerId, target);
  if (!relation) return { ok: false, error: 'already_at_war' };
  if (relation.warAt !== undefined) return { ok: false, error: 'war_pending' };

  const next = structuredClone(state);
  // Pending offers between the two are pointless once war is declared.
  for (const p of next.proposals) {
    if ((p.from === playerId && p.to === target) || (p.from === target && p.to === playerId)) setOfferStatus(next, p.id, 'cancelled');
  }
  next.proposals = next.proposals.filter((p) => !((p.from === playerId && p.to === target) || (p.from === target && p.to === playerId)));

  const notice = Math.max(0, Math.floor(rules.diplomacy.warNoticeTicks));
  const [a, b] = pairOf(playerId, target);
  if (notice === 0) {
    next.relations = next.relations.filter((r) => !samePair(r, playerId, target));
    postDirect(next, playerId, target, playerId, { kind: 'notice', notice: 'war_declared', warAt: next.tick }, rules);
    next.events.push({ tick: orderTick(next), type: 'war_declared', from: playerId, to: target, warAt: next.tick });
    next.events.push({ tick: orderTick(next), type: 'relation_changed', a, b, status: 'war', reason: 'declared' });
    return { ok: true, state: next };
  }

  const nextRelation = findRelationship(next, playerId, target);
  if (!nextRelation) return { ok: false, error: 'already_at_war' };
  nextRelation.warAt = next.tick + notice;
  postDirect(next, playerId, target, playerId, { kind: 'notice', notice: 'war_declared', warAt: nextRelation.warAt }, rules);
  next.events.push({ tick: orderTick(next), type: 'war_declared', from: playerId, to: target, warAt: nextRelation.warAt });
  return { ok: true, state: next };
}

/** Writes a treaty into the state (mutates the private copy given by the caller). */
function signTreaty(state: GameState, rules: Ruleset, x: PlayerId, y: PlayerId, kind: TreatyKind): void {
  const [a, b] = pairOf(x, y);
  state.relations = state.relations.filter((r) => !samePair(r, x, y));
  const relation: Relationship = { a, b, kind };
  if (kind === 'truce') relation.until = state.tick + rules.diplomacy.truceTicks;
  state.relations.push(relation);
  state.relations.sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Runs at the start of every tick (after the tick counter moved):
 *   - declarations of war whose notice is over take effect;
 *   - truces that ran out turn into war;
 *   - proposals nobody answered are withdrawn;
 *   - treaties and proposals of eliminated players are dropped.
 * Mutates the given state, which is always the private copy created by tick().
 */
export function processDiplomacy(state: GameState, rules?: Ruleset): void {
  const kept: Relationship[] = [];
  for (const relation of state.relations) {
    const gone = state.eliminated.includes(relation.a) || state.eliminated.includes(relation.b);
    if (gone) continue; // nothing to announce: the player left the game

    if (relation.warAt !== undefined && state.tick >= relation.warAt) {
      postDirect(state, relation.a, relation.b, null, { kind: 'notice', notice: 'war_started' }, rules, true);
      state.events.push({ tick: state.tick, type: 'relation_changed', a: relation.a, b: relation.b, status: 'war', reason: 'declared' });
      continue;
    }
    if (relation.kind === 'truce' && relation.until !== undefined && state.tick >= relation.until) {
      postDirect(state, relation.a, relation.b, null, { kind: 'notice', notice: 'truce_expired' }, rules, true);
      state.events.push({ tick: state.tick, type: 'relation_changed', a: relation.a, b: relation.b, status: 'war', reason: 'expired' });
      continue;
    }
    kept.push(relation);
  }
  state.relations = kept;

  const open: Proposal[] = [];
  for (const proposal of state.proposals) {
    if (state.eliminated.includes(proposal.from) || state.eliminated.includes(proposal.to)) {
      setOfferStatus(state, proposal.id, 'cancelled');
      continue;
    }
    if (state.tick >= proposal.expiresAt) {
      setOfferStatus(state, proposal.id, 'expired');
      state.events.push({
        tick: state.tick,
        type: 'proposal_expired',
        proposalId: proposal.id,
        from: proposal.from,
        to: proposal.to,
        kind: proposal.kind,
      });
      continue;
    }
    open.push(proposal);
  }
  state.proposals = open;
}
