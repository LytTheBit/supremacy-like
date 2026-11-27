import type { Bundle, ChatMessage, GameState } from '@supremacy/sim';
import { useState } from 'react';
import { formatBundle, errorText, playerName } from '../labels';
import { resourceIcon } from '../icons';
import { t, useLocale } from '../i18n';
import { HUMAN_ID, type GameSession } from '../session';

interface MessageViewProps {
  session: GameSession;
  state: GameState;
  message: ChatMessage;
  /** False for chats the player only overheard: nothing can be answered there. */
  interactive: boolean;
}

/** One entry of a conversation: a bubble of text, an offer card, a gift or a notice of the game. */
export function MessageView({ session, state, message, interactive }: MessageViewProps) {
  useLocale();
  const { content } = message;
  const mine = message.from === HUMAN_ID;
  const sender = message.from === null ? null : playerName(state.players, message.from);

  if (content.kind === 'notice') {
    const text =
      content.notice === 'war_declared'
        ? content.warAt !== undefined && content.warAt > message.tick
          ? t('chat.notice.war_declared.delayed', { name: sender ?? '', tick: content.warAt })
          : t('chat.notice.war_declared', { name: sender ?? '' })
        : t(`chat.notice.${content.notice}`);
    return <div className="chat-notice">{text}</div>;
  }

  return (
    <div className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
      <div className="chat-meta">
        <span>{mine ? t('chat.you') : (sender ?? '')}</span>
        <span className="muted">{t('chat.tick', { tick: message.tick })}</span>
      </div>
      {content.kind === 'text' ? <div className="chat-bubble">{content.text}</div> : null}
      {content.kind === 'treaty' ? <TreatyCard session={session} state={state} message={message} interactive={interactive} /> : null}
      {content.kind === 'trade' ? <TradeCard session={session} state={state} message={message} interactive={interactive} /> : null}
      {content.kind === 'gift' ? (
        <div className="chat-card gift">
          <div className="chat-card-title">{t('chat.card.gift', { name: mine ? t('chat.you') : (sender ?? '') })}</div>
          <BundleLines bundle={content.give} session={session} />
        </div>
      ) : null}
    </div>
  );
}

/** Resources and provinces of a bundle, one line each, with the resource pictures. */
function BundleLines({ bundle, session }: { bundle: Bundle; session: GameSession }) {
  useLocale();
  const entries = Object.entries(bundle.resources).filter(([, amount]) => amount > 0);
  if (entries.length === 0 && bundle.provinces.length === 0) return <div className="muted small">{t('format.nothing')}</div>;
  return (
    <ul className="plain bundle">
      {entries.map(([resource]) => (
        <li key={resource}>
          <span aria-hidden>{resourceIcon(resource)}</span>{' '}
          {formatBundle({ resources: { [resource]: bundle.resources[resource] ?? 0 }, provinces: [] }, (id) => session.provinceName(id))}
        </li>
      ))}
      {bundle.provinces.map((id) => (
        <li key={id}>
          <span aria-hidden>🗺️</span> {session.provinceName(id)}
        </li>
      ))}
    </ul>
  );
}

function StatusChip({ status }: { status: 'open' | 'accepted' | 'rejected' | 'expired' | 'cancelled' }) {
  useLocale();
  return <span className={`chat-status status-${status}`}>{t(`chat.status.${status}`)}</span>;
}

function TreatyCard({ session, state, message, interactive }: MessageViewProps) {
  useLocale();
  const [error, setError] = useState<string | null>(null);
  const content = message.content;
  if (content.kind !== 'treaty') return null;
  const proposal = state.proposals.find((p) => p.id === content.proposalId);
  const incoming = content.status === 'open' && proposal?.to === HUMAN_ID && interactive;
  const name = message.from === HUMAN_ID ? t('chat.you') : playerName(state.players, message.from);

  const answer = (accept: boolean) => {
    const result = session.respond(content.proposalId, accept);
    setError(result.ok ? null : errorText(result.error));
  };

  return (
    <div className="chat-card treaty">
      <div className="chat-card-title">{t('chat.card.treaty', { name, treaty: t(`chat.treaty.${content.treaty}`) })}</div>
      <div className="chat-card-foot">
        <StatusChip status={content.status} />
        {content.status === 'open' && proposal ? (
          <span className="muted small">{t('chat.card.expires', { count: Math.max(0, proposal.expiresAt - state.tick) })}</span>
        ) : null}
      </div>
      {incoming ? (
        <div className="chips">
          <button className="primary" onClick={() => answer(true)}>
            {t('chat.card.accept')}
          </button>
          <button onClick={() => answer(false)}>{t('chat.card.reject')}</button>
        </div>
      ) : null}
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}

function TradeCard({ session, state, message, interactive }: MessageViewProps) {
  useLocale();
  const [error, setError] = useState<string | null>(null);
  const content = message.content;
  if (content.kind !== 'trade') return null;
  const trade = state.trades.find((x) => x.id === content.tradeId);
  const open = content.status === 'open' && trade !== undefined && interactive;
  const incoming = open && trade.to === HUMAN_ID;
  const outgoing = open && trade.from === HUMAN_ID;
  const name = message.from === HUMAN_ID ? t('chat.you') : playerName(state.players, message.from);
  const blocked = incoming ? session.checkRespondTrade(content.tradeId) : null;

  const run = (result: { ok: true } | { ok: false; error: string }) => setError(result.ok ? null : errorText(result.error));

  return (
    <div className="chat-card trade">
      <div className="chat-card-title">{t('chat.card.trade', { name })}</div>
      <div className="trade-sides">
        <div>
          <div className="muted small">{t('chat.card.gives')}</div>
          <BundleLines bundle={content.give} session={session} />
        </div>
        <div>
          <div className="muted small">{t('chat.card.wants')}</div>
          <BundleLines bundle={content.want} session={session} />
        </div>
      </div>
      <div className="chat-card-foot">
        <StatusChip status={content.status} />
        {open && trade ? <span className="muted small">{t('chat.card.expires', { count: Math.max(0, trade.expiresAt - state.tick) })}</span> : null}
      </div>
      {incoming ? (
        <div className="chips">
          <button
            className="primary"
            disabled={blocked !== null}
            title={blocked ? errorText(blocked) : undefined}
            onClick={() => run(session.respondTrade(content.tradeId, true))}
          >
            {t('chat.card.accept')}
          </button>
          <button onClick={() => run(session.respondTrade(content.tradeId, false))}>{t('chat.card.reject')}</button>
        </div>
      ) : null}
      {outgoing ? (
        <div className="chips">
          <button onClick={() => run(session.cancelTrade(content.tradeId))}>{t('chat.card.cancel')}</button>
        </div>
      ) : null}
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}
