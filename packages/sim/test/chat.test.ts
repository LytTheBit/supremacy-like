import { describe, expect, it } from 'vitest';
import {
  baseRuleset,
  chatsOf,
  createGame,
  directChatId,
  duelMap,
  findDirectChat,
  orderDeclareWar,
  orderPropose,
  orderRespond,
  orderSendMessage,
  orderSendToChat,
  orderSpy,
  tick,
  viewFor,
  type GameState,
  type Ruleset,
} from '../src';

const rules: Ruleset = baseRuleset;
const owners = {
  rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
  bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
  mnorth: 'green', // a player with no province is out of the game
};

function game(ruleset: Ruleset = rules): GameState {
  return createGame({
    map: duelMap,
    rules: ruleset,
    players: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
      { id: 'green', name: 'Green' },
    ],
    owners,
    armies: [
      { id: 'r1', owner: 'red', location: 'rcap', units: { infantry: 5 } },
      { id: 'b1', owner: 'blue', location: 'bcap', units: { infantry: 5 } },
    ],
    stockpiles: { green: { grain: 100000, wood: 100000 } },
  });
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function say(state: GameState, from: string, to: string, text: string): GameState {
  return must(orderSendMessage(state, rules, from, to, text)).state;
}

/** Green's spy gets into place in blue's capital. */
function withSpyOnBlue(state: GameState): GameState {
  let current = must(orderSpy(state, rules, 'green', 'bcap')).state;
  for (let i = 0; i < rules.espionage!.infiltrateTicks; i++) current = tick(current, rules);
  return current;
}

describe('chat', () => {
  it('creates the direct chat on the first message, the same one in both directions', () => {
    let state = game();
    expect(state.chats).toEqual([]);
    state = say(state, 'red', 'blue', '  hello  ');
    state = say(state, 'blue', 'red', 'hi');
    expect(state.chats).toHaveLength(1);
    const chat = findDirectChat(state, 'blue', 'red')!;
    expect(chat.id).toBe(directChatId('red', 'blue'));
    expect(chat.participants).toEqual(['blue', 'red']);
    expect(chat.messages.map((m) => [m.from, m.content])).toEqual([
      ['red', { kind: 'text', text: 'hello' }],
      ['blue', { kind: 'text', text: 'hi' }],
    ]);
    expect(chatsOf(state, 'green')).toEqual([]);
  });

  it('refuses empty or long texts, strangers and the dead, and leaves the input untouched', () => {
    const state = game();
    const snapshot = structuredClone(state);
    expect(orderSendMessage(state, rules, 'red', 'blue', '   ')).toEqual({ ok: false, error: 'empty_message' });
    expect(orderSendMessage(state, rules, 'red', 'blue', 'x'.repeat(401))).toEqual({ ok: false, error: 'message_too_long' });
    expect(orderSendMessage(state, rules, 'red', 'red', 'hi')).toEqual({ ok: false, error: 'same_player' });
    expect(orderSendMessage(state, rules, 'red', 'ghost', 'hi')).toEqual({ ok: false, error: 'player_not_found' });
    expect(orderSendMessage({ ...state, eliminated: ['blue'] }, rules, 'red', 'blue', 'hi')).toEqual({ ok: false, error: 'player_eliminated' });
    expect(state).toEqual(snapshot);
  });

  it('keeps only the latest messages of a chat', () => {
    const small: Ruleset = { ...rules, chat: { maxMessages: 3, maxTextLength: 50, maxOpenTrades: 3 } };
    let state = game(small);
    for (let i = 1; i <= 5; i++) state = must(orderSendMessage(state, small, 'red', 'blue', `m${i}`)).state;
    expect(findDirectChat(state, 'red', 'blue')!.messages.map((m) => (m.content as { text: string }).text)).toEqual(['m3', 'm4', 'm5']);
  });

  it('writes to an existing chat by id, only for its participants (the way group chats will work)', () => {
    let state = say(game(), 'red', 'blue', 'hi');
    const id = directChatId('red', 'blue');
    state = must(orderSendToChat(state, rules, 'blue', id, 'again')).state;
    expect(findDirectChat(state, 'red', 'blue')!.messages).toHaveLength(2);
    expect(orderSendToChat(state, rules, 'green', id, 'psst')).toEqual({ ok: false, error: 'not_participant' });
    expect(orderSendToChat(state, rules, 'red', 'dm:nobody', 'hi')).toEqual({ ok: false, error: 'chat_not_found' });
  });

  it('shows treaty offers as cards whose status follows the offer', () => {
    let state = must(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    const card = () => findDirectChat(state, 'red', 'blue')!.messages.at(-1)!.content;
    expect(card()).toMatchObject({ kind: 'treaty', treaty: 'truce', status: 'open' });
    const proposalId = state.proposals[0]!.id;
    state = must(orderRespond(state, rules, 'blue', proposalId, true)).state;
    expect(card()).toMatchObject({ status: 'accepted' });

    let other = must(orderPropose(game(), rules, 'red', 'blue', 'alliance')).state;
    other = must(orderRespond(other, rules, 'blue', other.proposals[0]!.id, false)).state;
    expect(findDirectChat(other, 'red', 'blue')!.messages.at(-1)!.content).toMatchObject({ status: 'rejected' });
  });

  it('expires the card with the proposal and closes it when war is declared', () => {
    let state = must(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    for (let i = 0; i < rules.diplomacy.proposalTicks; i++) state = tick(state, rules);
    expect(findDirectChat(state, 'red', 'blue')!.messages[0]!.content).toMatchObject({ status: 'expired' });

    // Truce, then an alliance offer, then war: the pending card is cancelled and the war is told in the chat.
    let peace = must(orderPropose(game(), rules, 'red', 'blue', 'truce')).state;
    peace = must(orderRespond(peace, rules, 'blue', peace.proposals[0]!.id, true)).state;
    peace = must(orderPropose(peace, rules, 'red', 'blue', 'alliance')).state;
    peace = must(orderDeclareWar(peace, rules, 'red', 'blue')).state;
    const messages = findDirectChat(peace, 'red', 'blue')!.messages;
    expect(messages.find((m) => m.content.kind === 'treaty' && m.content.treaty === 'alliance')!.content).toMatchObject({ status: 'cancelled' });
    expect(messages.at(-1)).toMatchObject({ from: 'red', content: { kind: 'notice', notice: 'war_declared' } });
    for (let i = 0; i < rules.diplomacy.warNoticeTicks; i++) peace = tick(peace, rules);
    expect(findDirectChat(peace, 'red', 'blue')!.messages.at(-1)).toMatchObject({ from: null, content: { kind: 'notice', notice: 'war_started' } });
  });
});

describe('chat privacy and spies', () => {
  it('hides other people\'s chats from a player without a spy', () => {
    const state = say(game(), 'red', 'blue', 'secret');
    expect(viewFor(state, rules, 'green').state.chats).toEqual([]);
    expect(viewFor(state, rules, 'red').state.chats).toHaveLength(1);
    expect(viewFor(state, rules, 'blue').state.chats).toHaveLength(1);
  });

  it('lets a spy in place read what is said from then on', () => {
    let state = withSpyOnBlue(game());
    state = say(state, 'red', 'blue', 'attack at dawn');
    const view = viewFor(state, rules, 'green').state;
    expect(view.chats).toHaveLength(1);
    expect(view.chats[0]!.participants).toEqual(['blue', 'red']);
    expect(view.chats[0]!.messages.map((m) => m.content)).toEqual([{ kind: 'text', text: 'attack at dawn' }]);
    expect(state.events.some((e) => e.type === 'chat_intercepted' && e.owner === 'green')).toBe(true);
  });

  it('gives context: the last messages before the spy arrived (and not older ones)', () => {
    let state = game();
    for (let i = 1; i <= 10; i++) state = say(state, i % 2 ? 'red' : 'blue', i % 2 ? 'blue' : 'red', `m${i}`);
    state = withSpyOnBlue(state);
    const texts = viewFor(state, rules, 'green').state.chats[0]!.messages.map((m) => (m.content as { text: string }).text);
    expect(texts).toEqual(['m5', 'm6', 'm7', 'm8', 'm9', 'm10']);
  });

  it('stays secret from the people talking and keeps what was heard after the spy is gone', () => {
    let state = withSpyOnBlue(game());
    state = say(state, 'red', 'blue', 'one');
    const own = viewFor(state, rules, 'blue').state.chats[0]!;
    expect(own.messages.every((m) => m.interceptedBy === undefined)).toBe(true);
    expect(viewFor(state, rules, 'blue').state.events.some((e) => e.type === 'chat_intercepted')).toBe(false);

    // The spy leaves (cover blown): it keeps reading what it already heard, not what comes next.
    for (let i = 0; i < rules.espionage!.coverTicks + 1; i++) state = tick(state, rules);
    expect(state.spies).toHaveLength(0);
    state = say(state, 'red', 'blue', 'two');
    const heard = viewFor(state, rules, 'green').state.chats[0]!.messages.map((m) => (m.content as { text: string }).text);
    expect(heard).toEqual(['one']);
  });

  it('does not let a spy read chats of players it does not watch', () => {
    let state = withSpyOnBlue(game());
    state = say(state, 'red', 'green', 'hi green');
    // Green is in this chat: its own, in full. Nothing of red-blue exists.
    expect(viewFor(state, rules, 'green').state.chats).toHaveLength(1);
    state = say(state, 'red', 'blue', 'x');
    expect(viewFor(state, rules, 'green').state.chats).toHaveLength(2);
  });
});
