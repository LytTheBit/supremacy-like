import { findRelationship, type GameState } from '@supremacy/sim';
import { useState } from 'react';
import { conversationsFor } from '../chat-model';
import { ownerColor } from '../colors';
import { formatAmount } from '../format';
import { t, tOr, useLocale } from '../i18n';
import { playerName, resourceName } from '../labels';
import { HUMAN_ID, type GameSession } from '../session';

interface DiplomacyPanelProps {
  session: GameSession;
  state: GameState;
  chatRead: Record<string, number>;
  /** Opens the Chat window on the conversation with a player. */
  onOpenChat: (playerId: string) => void;
}

/**
 * Where we stand with every other player: war, truce or alliance, and the way to declare war.
 * Offers and agreements are made in the Chat (the button opens it on that player).
 */
export function DiplomacyPanel({ session, state, chatRead, onOpenChat }: DiplomacyPanelProps) {
  useLocale();
  const others = state.players.filter((p) => p.id !== HUMAN_ID);
  if (others.length === 0) return null;

  return (
    <div className="card">
      <h3>{t('diplomacy.title')}</h3>
      {others.map((player) => (
        <PlayerRelation key={player.id} session={session} state={state} chatRead={chatRead} playerId={player.id} onOpenChat={onOpenChat} />
      ))}
    </div>
  );
}

function PlayerRelation(props: {
  session: GameSession;
  state: GameState;
  chatRead: Record<string, number>;
  playerId: string;
  onOpenChat: (playerId: string) => void;
}) {
  const { session, state, chatRead, playerId, onOpenChat } = props;
  const name = playerName(state.players, playerId);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmWar, setConfirmWar] = useState(false);

  const eliminated = state.eliminated.includes(playerId);
  const relation = findRelationship(state, HUMAN_ID, playerId);
  const status = relation?.kind ?? 'war';
  const warPending = relation?.warAt !== undefined;
  const attention = conversationsFor(state, HUMAN_ID, chatRead)
    .filter((c) => c.other === playerId)
    .reduce((sum, c) => sum + c.unread + c.pending, 0);

  const run = (result: { ok: true } | { ok: false; error: string }) => {
    setMessage(result.ok ? null : tOr(`error.${result.error}`, result.error));
    setConfirmWar(false);
  };

  let statusText: string;
  if (eliminated) statusText = t('diplomacy.status.eliminated');
  else if (warPending && relation?.warAt !== undefined) {
    statusText = t('diplomacy.status.warPending', { count: Math.max(0, relation.warAt - state.tick) });
  } else if (status === 'truce') {
    statusText = t('diplomacy.status.truce', { count: Math.max(0, (relation?.until ?? state.tick) - state.tick) });
  } else if (status === 'alliance') statusText = t('diplomacy.status.alliance');
  else statusText = t('diplomacy.status.war');

  // What our spies report about this player's stockpile (empty without a spy in place).
  const known = state.players.find((p) => p.id === playerId)?.stockpile ?? {};
  const intel = Object.entries(known)
    .map(([resource, amount]) => `${resourceName(resource)} ${formatAmount(amount)}`)
    .join(', ');

  const canDeclareWar = !eliminated && !warPending && status !== 'war';

  return (
    <div className="rel">
      <div className="rel-head">
        <strong>
          <span className="dot" style={{ background: ownerColor(playerId) }} /> {name}
        </strong>
        <span className={`rel-status rel-${eliminated ? 'war' : status}`}>{statusText}</span>
      </div>

      <div className="chips">
        {!eliminated ? (
          <button onClick={() => onOpenChat(playerId)} title={t('diplomacy.chatHint')}>
            💬 {t('diplomacy.chat')}
            {attention > 0 ? <span className="badge-count">{attention}</span> : null}
          </button>
        ) : null}
        {canDeclareWar ? (
          confirmWar ? (
            <button className="primary" onClick={() => run(session.declareWar(playerId))}>
              {t('diplomacy.confirmWar')}
            </button>
          ) : (
            <button onClick={() => setConfirmWar(true)}>{t('diplomacy.declareWar')}</button>
          )
        ) : null}
      </div>

      {intel ? <p className="muted small">{t('diplomacy.intel', { resources: intel })}</p> : null}
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
