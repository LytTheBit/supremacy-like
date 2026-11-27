import type { Chat, GameState } from '@supremacy/sim';
import { useEffect, useMemo, useRef, useState } from 'react';
import { conversationsFor, interceptedChats, newestMessage } from '../chat-model';
import { ownerColor } from '../colors';
import { t, useLocale } from '../i18n';
import { errorText, playerName } from '../labels';
import { HUMAN_ID, type GameSession } from '../session';
import { MessageView } from './ChatCards';
import { DealForm } from './DealForm';

interface ChatModalProps {
  session: GameSession;
  state: GameState;
  chatRead: Record<string, number>;
  /** The chat to open: a direct chat id, or null for the first conversation of the list. */
  initialChat: string | null;
  onClose: () => void;
}

/** The id of the "overheard" tab: chats of other people that spies listened to. */
const INTERCEPTED = 'intercepted';

/**
 * The Chat window. Everything players say to each other happens here: texts, treaty offers,
 * deals and gifts, notices of war. A tab per conversation (group chats will be tabs too), and a
 * tab with the conversations the player's spies overheard.
 */
export function ChatModal({ session, state, chatRead, initialChat, onClose }: ChatModalProps) {
  useLocale();
  const conversations = useMemo(() => conversationsFor(state, HUMAN_ID, chatRead), [state, chatRead]);
  const overheard = useMemo(() => interceptedChats(state, HUMAN_ID), [state]);
  const [selected, setSelected] = useState<string>(initialChat ?? conversations[0]?.id ?? INTERCEPTED);
  const [dealOpen, setDealOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const current = conversations.find((c) => c.id === selected) ?? null;
  const showingOverheard = selected === INTERCEPTED;
  const chat: Chat | null = current?.chat ?? null;

  // What is on screen counts as read.
  const newest = newestMessage(chat);
  useEffect(() => {
    if (current && newest > 0) session.markChatRead(current.id, newest);
  }, [session, current, newest]);

  // Stay at the bottom as messages arrive.
  const messageCount = showingOverheard ? overheard.reduce((n, c) => n + c.messages.length, 0) : (chat?.messages.length ?? 0);
  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [messageCount, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const other = current?.other ?? null;
  const send = () => {
    if (other === null) return;
    const result = session.sendMessage(other, text);
    if (result.ok) {
      setText('');
      setError(null);
    } else if (result.error !== 'empty_message') {
      setError(errorText(result.error));
    }
  };

  const title = showingOverheard
    ? t('chat.intercepted')
    : other !== null
      ? playerName(state.players, other)
      : t('chat.title');

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal chat-modal" role="dialog" aria-modal="true" aria-label={t('chat.title')}>
        <header className="chat-header">
          {other !== null && !showingOverheard ? <span className="dot big" style={{ background: ownerColor(other) }} /> : null}
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label={t('chat.close')} title={t('chat.close')}>
            ✕
          </button>
        </header>

        <nav className="chat-tabs" aria-label={t('chat.conversations')}>
          {conversations.length === 0 ? <span className="muted small">{t('chat.nobody')}</span> : null}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={selected === c.id ? 'active' : ''}
              onClick={() => {
                setSelected(c.id);
                setDealOpen(false);
                setError(null);
              }}
            >
              {c.other !== null ? <span className="dot" style={{ background: ownerColor(c.other) }} /> : null}{' '}
              {c.other !== null ? playerName(state.players, c.other) : t('chat.title')}
              {c.unread + c.pending > 0 ? <span className="badge-count">{c.unread + c.pending}</span> : null}
            </button>
          ))}
          <button
            className={`spy-tab ${showingOverheard ? 'active' : ''}`}
            onClick={() => {
              setSelected(INTERCEPTED);
              setDealOpen(false);
            }}
          >
            🕵 {t('chat.intercepted')}
            {overheard.length > 0 ? <span className="badge-count">{overheard.length}</span> : null}
          </button>
        </nav>

        <section className="chat-thread">
          {showingOverheard ? (
            <>
              <p className="muted small">{t('chat.interceptedNotice')}</p>
              {overheard.length === 0 ? <p className="muted">{t('chat.interceptedNone')}</p> : null}
              {overheard.map((heard) => (
                <div className="overheard" key={heard.id}>
                  <h3>
                    {t('chat.interceptedTitle', { names: heard.participants.map((id) => playerName(state.players, id)).join(', ') })}
                  </h3>
                  {heard.messages.map((message) => (
                    <MessageView key={message.id} session={session} state={state} message={message} interactive={false} />
                  ))}
                </div>
              ))}
            </>
          ) : chat && chat.messages.length > 0 ? (
            chat.messages.map((message) => (
              <MessageView key={message.id} session={session} state={state} message={message} interactive />
            ))
          ) : (
            <p className="muted">{t('chat.empty')}</p>
          )}
          <div ref={threadEnd} />
        </section>

        {!showingOverheard && other !== null ? (
          <footer className="chat-footer">
            {dealOpen ? (
              <DealForm
                session={session}
                state={state}
                other={other}
                onDone={() => setDealOpen(false)}
                onCancel={() => setDealOpen(false)}
              />
            ) : null}
            {error ? <p className="error small">{error}</p> : null}
            <div className="chat-compose">
              <input
                type="text"
                value={text}
                maxLength={session.rules.chat?.maxTextLength}
                placeholder={t('chat.placeholder')}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') send();
                }}
              />
              <button className="primary" onClick={send}>
                {t('chat.send')}
              </button>
              <button className={dealOpen ? 'active' : ''} onClick={() => setDealOpen(!dealOpen)} title={t('chat.deal')}>
                💰 {t('chat.deal')}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
