import { directChatId, messageNumber, type Bundle, type Chat, type GameState, type PlayerId, type ResourceId } from '@supremacy/sim';

/**
 * What the chat window shows, worked out from the game state. Pure functions, no React: the window
 * only draws what these return.
 */

/** A conversation of the player in the list: a real chat, or a person nobody has written to yet. */
export interface Conversation {
  /** Chat id (the direct chat id, also for people the player has not talked to yet). */
  id: string;
  /** The other player of a direct chat. Group chats (later) have none. */
  other: PlayerId | null;
  chat: Chat | null;
  /** Messages from others the player has not seen. */
  unread: number;
  /** Open offers of this conversation waiting for the player's answer. */
  pending: number;
}

function lastMessageNumber(chat: Chat | null): number {
  const last = chat?.messages.at(-1);
  return last ? messageNumber(last.id) : 0;
}

/** Messages of a chat from other people that are newer than what the player has read. */
export function unreadCount(chat: Chat, humanId: PlayerId, readUpTo: number): number {
  return chat.messages.filter((m) => m.from !== humanId && messageNumber(m.id) > readUpTo).length;
}

/** Open offers (treaties and trades) in a chat that wait for this player. */
export function pendingOffers(state: GameState, chat: Chat | null, humanId: PlayerId): number {
  if (!chat) return 0;
  return chat.messages.filter((m) => {
    if (m.content.kind === 'treaty') {
      return m.content.status === 'open' && state.proposals.some((p) => p.id === (m.content as { proposalId: string }).proposalId && p.to === humanId);
    }
    if (m.content.kind === 'trade') {
      return m.content.status === 'open' && state.trades.some((t) => t.id === (m.content as { tradeId: string }).tradeId && t.to === humanId);
    }
    return false;
  }).length;
}

/**
 * The player's conversations: one with every other player still in the game (even before the first
 * message), the ones with something new first, then the most recently active. Chats the player is
 * not in (overheard by spies) are not here: see `interceptedChats`.
 */
export function conversationsFor(
  state: GameState,
  humanId: PlayerId,
  readUpTo: Readonly<Record<string, number>>,
): Conversation[] {
  const result: Conversation[] = [];
  for (const chat of state.chats) {
    if (!chat.participants.includes(humanId)) continue;
    const others = chat.participants.filter((p) => p !== humanId);
    result.push({
      id: chat.id,
      other: chat.kind === 'direct' ? (others[0] ?? null) : null,
      chat,
      unread: unreadCount(chat, humanId, readUpTo[chat.id] ?? 0),
      pending: pendingOffers(state, chat, humanId),
    });
  }
  for (const player of state.players) {
    if (player.id === humanId || state.eliminated.includes(player.id)) continue;
    const id = directChatId(humanId, player.id);
    if (!result.some((c) => c.id === id)) result.push({ id, other: player.id, chat: null, unread: 0, pending: 0 });
  }
  return result
    .filter((c) => c.other === null || !state.eliminated.includes(c.other) || c.chat !== null)
    .sort(
      (a, b) =>
        Number(b.unread + b.pending > 0) - Number(a.unread + a.pending > 0) ||
        lastMessageNumber(b.chat) - lastMessageNumber(a.chat) ||
        a.id.localeCompare(b.id),
    );
}

/** Chats the player is not in but has heard something of through spies, most recent first. */
export function interceptedChats(state: GameState, humanId: PlayerId): Chat[] {
  return state.chats
    .filter((c) => !c.participants.includes(humanId) && c.messages.length > 0)
    .sort((a, b) => lastMessageNumber(b) - lastMessageNumber(a) || a.id.localeCompare(b.id));
}

/** Total of new messages and open offers over all the player's chats (the badge of the Chat button). */
export function totalAttention(conversations: Conversation[]): number {
  return conversations.reduce((sum, c) => sum + c.unread + c.pending, 0);
}

/** The highest message number of a chat (what "read it all" means). */
export function newestMessage(chat: Chat | null): number {
  return lastMessageNumber(chat);
}

/**
 * Builds a bundle from what the deal form holds: text amounts per resource (empty or invalid means
 * nothing) and the ticked provinces.
 */
export function parseBundle(amounts: Readonly<Record<ResourceId, string>>, provinces: Iterable<string>): Bundle {
  const resources: Record<ResourceId, number> = {};
  for (const [resource, text] of Object.entries(amounts)) {
    const value = Number(text.replace(',', '.'));
    if (Number.isFinite(value) && value > 0) resources[resource] = value;
  }
  return { resources, provinces: [...provinces].sort() };
}

export function bundleIsEmpty(bundle: Bundle): boolean {
  return bundle.provinces.length === 0 && Object.keys(bundle.resources).length === 0;
}
