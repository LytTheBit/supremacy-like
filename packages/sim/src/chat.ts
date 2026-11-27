import type {
  Chat,
  ChatContent,
  ChatMessage,
  ChatRules,
  GameState,
  OfferStatus,
  PlayerId,
  Ruleset,
} from './types';

/**
 * Chats: the one place where players talk and deal.
 *
 * Every conversation is a `Chat` with a list of participants. Today they are all `direct` (two
 * players, created the first time they talk); `group` chats for alliances use the same shape.
 * A message is a piece of text, an offer card (a treaty or a trade, with its status), a gift that
 * was delivered, or a notice of the game. The offers themselves live in `proposals` and `trades`:
 * the cards only show them, and their status follows the offer.
 *
 * Spies listen: a spy in place in a province of a chat participant reads the messages posted from
 * then on, and the last few before it arrived (the context), see `interceptRecent`.
 */

export const DEFAULT_CHAT_RULES: ChatRules = { maxMessages: 200, maxTextLength: 400, maxOpenTrades: 3 };

/** The chat limits of a game (the defaults when the ruleset sets none). */
export function chatRules(rules?: Ruleset): ChatRules {
  return rules?.chat ?? DEFAULT_CHAT_RULES;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The id of the direct chat between two players (the same whichever order they are given in). */
export function directChatId(a: PlayerId, b: PlayerId): string {
  return a < b ? `dm:${a}|${b}` : `dm:${b}|${a}`;
}

export function findChat(state: GameState, chatId: string): Chat | null {
  return state.chats.find((c) => c.id === chatId) ?? null;
}

/** The direct chat between two players, or null while they have not talked. */
export function findDirectChat(state: GameState, a: PlayerId, b: PlayerId): Chat | null {
  return findChat(state, directChatId(a, b));
}

/** Chats the player takes part in. */
export function chatsOf(state: GameState, playerId: PlayerId): Chat[] {
  return state.chats.filter((c) => c.participants.includes(playerId));
}

/** The number in a message id (`msg-12` is 12): ids only grow, so it tells which message is newer. */
export function messageNumber(messageId: string): number {
  return Number(messageId.slice(messageId.lastIndexOf('-') + 1)) || 0;
}

// ---------------------------------------------------------------------------
// Posting (mutate the private copy given by the caller)
// ---------------------------------------------------------------------------

function ensureDirectChat(state: GameState, a: PlayerId, b: PlayerId): Chat {
  const id = directChatId(a, b);
  let chat = findChat(state, id);
  if (!chat) {
    chat = { id, kind: 'direct', participants: [a, b].sort(), messages: [] };
    state.chats.push(chat);
  }
  return chat;
}

/**
 * Adds a message to a chat, drops the oldest ones when the chat is full and lets the spies listen.
 * `from` is the sender, or null for a notice of the game.
 */
export function postMessage(
  state: GameState,
  chat: Chat,
  from: PlayerId | null,
  content: ChatContent,
  rules?: Ruleset,
  /** True inside `tick()` (events are stamped with the current tick instead of the next one). */
  inTick = false,
): ChatMessage {
  const message: ChatMessage = { id: `msg-${state.nextId}`, tick: state.tick, from, content };
  state.nextId += 1;
  chat.messages.push(message);
  const limit = chatRules(rules).maxMessages;
  if (chat.messages.length > limit) chat.messages.splice(0, chat.messages.length - limit);
  wiretap(state, chat, message, inTick);
  return message;
}

/** Posts into the direct chat between two players (made on the spot if they have never talked). */
export function postDirect(
  state: GameState,
  a: PlayerId,
  b: PlayerId,
  from: PlayerId | null,
  content: ChatContent,
  rules?: Ruleset,
  inTick = false,
): ChatMessage {
  return postMessage(state, ensureDirectChat(state, a, b), from, content, rules, inTick);
}

/**
 * Updates the card of an offer in whichever chat shows it (a proposal or a trade, by id).
 * Cards of offers that are no longer open keep their last status.
 */
export function setOfferStatus(state: GameState, offerId: string, status: OfferStatus): void {
  for (const chat of state.chats) {
    for (const message of chat.messages) {
      const content = message.content;
      if (content.kind === 'treaty' && content.proposalId === offerId) content.status = status;
      else if (content.kind === 'trade' && content.tradeId === offerId) content.status = status;
    }
  }
}

// ---------------------------------------------------------------------------
// Wiretapping
// ---------------------------------------------------------------------------

/** Spy owners that listen to a chat right now: a spy in place in a province of a participant. */
function listenersOf(state: GameState, chat: Chat): PlayerId[] {
  const heard = new Set<PlayerId>();
  for (const spy of state.spies) {
    if (spy.infiltrationLeft > 0 || chat.participants.includes(spy.owner)) continue;
    const province = state.provinces.find((p) => p.id === spy.provinceId);
    if (province?.owner && chat.participants.includes(province.owner)) heard.add(spy.owner);
  }
  return [...heard].sort();
}

function markIntercepted(state: GameState, chat: Chat, message: ChatMessage, owner: PlayerId, inTick: boolean): void {
  const marks = message.interceptedBy ?? [];
  if (marks.includes(owner)) return;
  message.interceptedBy = [...marks, owner].sort();
  state.events.push({
    tick: inTick ? state.tick : state.tick + 1,
    type: 'chat_intercepted',
    owner,
    chatId: chat.id,
    messageId: message.id,
    participants: [...chat.participants],
  });
}

function wiretap(state: GameState, chat: Chat, message: ChatMessage, inTick: boolean): void {
  for (const owner of listenersOf(state, chat)) markIntercepted(state, chat, message, owner, inTick);
}

/**
 * A spy of `owner` just got into place in a province of `target`: it also reads the last `count`
 * messages of every chat `target` takes part in, so what it hears makes sense.
 */
export function interceptRecent(state: GameState, owner: PlayerId, target: PlayerId, count: number): void {
  if (count <= 0) return;
  for (const chat of state.chats) {
    if (!chat.participants.includes(target) || chat.participants.includes(owner)) continue;
    for (const message of chat.messages.slice(-count)) markIntercepted(state, chat, message, owner, true);
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type ChatError =
  | 'game_over'
  | 'player_not_found'
  | 'same_player'
  | 'player_eliminated'
  | 'empty_message'
  | 'message_too_long'
  | 'chat_not_found'
  | 'not_participant';

export type ChatResult = { ok: true; state: GameState } | { ok: false; error: ChatError };

function cleanText(rules: Ruleset, text: string): { text: string } | { error: ChatError } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { error: 'empty_message' };
  if (trimmed.length > chatRules(rules).maxTextLength) return { error: 'message_too_long' };
  return { text: trimmed };
}

/** Sends a text to another player (their direct chat is created if needed). */
export function orderSendMessage(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  to: PlayerId,
  text: string,
): ChatResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  if (!state.players.some((p) => p.id === playerId) || !state.players.some((p) => p.id === to)) {
    return { ok: false, error: 'player_not_found' };
  }
  if (playerId === to) return { ok: false, error: 'same_player' };
  if (state.eliminated.includes(playerId) || state.eliminated.includes(to)) return { ok: false, error: 'player_eliminated' };
  const clean = cleanText(rules, text);
  if ('error' in clean) return { ok: false, error: clean.error };

  const next = structuredClone(state);
  postDirect(next, playerId, to, playerId, { kind: 'text', text: clean.text }, rules);
  return { ok: true, state: next };
}

/** Sends a text to an existing chat of any size (the way group chats will be written to). */
export function orderSendToChat(
  state: GameState,
  rules: Ruleset,
  playerId: PlayerId,
  chatId: string,
  text: string,
): ChatResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  const chat = findChat(state, chatId);
  if (!chat) return { ok: false, error: 'chat_not_found' };
  if (!chat.participants.includes(playerId)) return { ok: false, error: 'not_participant' };
  if (state.eliminated.includes(playerId)) return { ok: false, error: 'player_eliminated' };
  const clean = cleanText(rules, text);
  if ('error' in clean) return { ok: false, error: clean.error };

  const next = structuredClone(state);
  const nextChat = findChat(next, chatId);
  if (!nextChat) return { ok: false, error: 'chat_not_found' };
  postMessage(next, nextChat, playerId, { kind: 'text', text: clean.text }, rules);
  return { ok: true, state: next };
}
