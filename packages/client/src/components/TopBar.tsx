import { currencyOf, defaultMedals } from '@supremacy/sim';
import { conversationsFor, totalAttention } from '../chat-model';
import { resourceIcon } from '../icons';
import { formatAmount, formatRate } from '../format';
import { t, useLocale } from '../i18n';
import { medalName, resourceName } from '../labels';
import { HUMAN_ID, incomePerTick, type GameSession, type Snapshot } from '../session';
import { LanguageSelect } from './LanguageSelect';

/** Game speeds: ticks per second. 0 is the pause. */
const SPEEDS = [0, 1, 2, 5, 10];

interface TopBarProps {
  session: GameSession;
  snapshot: Snapshot;
  onNewGame: () => void;
  /** Opens the Chat window. */
  onOpenChat: () => void;
}

export function TopBar({ session, snapshot, onNewGame, onOpenChat }: TopBarProps) {
  useLocale();
  const { state, speed } = snapshot;
  const me = state.players.find((p) => p.id === HUMAN_ID);
  const income = incomePerTick(state, session.rules, HUMAN_ID);
  const medals = session.rules.medals.map((id) => {
    const medal = defaultMedals.find((m) => m.id === id);
    return medal ? medalName(medal) : id;
  });
  const currency = currencyOf(session.rules);
  const attention = totalAttention(conversationsFor(state, HUMAN_ID, snapshot.chatRead));
  const owned = state.provinces.filter((p) => p.owner === HUMAN_ID).length;

  return (
    <header className="topbar">
      <div className="title">
        {t('app.title')}
        {medals.length > 0 ? <span className="badge">{medals.join(', ')}</span> : null}
      </div>

      <div className="resources">
        {session.rules.resources.map((resource) => (
          <div className={`resource ${resource === currency ? 'currency' : ''}`} key={resource} title={resourceName(resource)}>
            <span className="label">
              <span aria-hidden>{resourceIcon(resource)}</span> {resourceName(resource)}
            </span>
            <span className="amount">{formatAmount(me?.stockpile[resource] ?? 0)}</span>
            <span className="income">{formatRate(income[resource] ?? 0)}</span>
          </div>
        ))}
      </div>

      <div className="status">{t('topbar.status', { tick: state.tick, owned, total: state.provinces.length })}</div>

      <div className="speeds">
        {SPEEDS.map((value) => (
          <button key={value} className={speed === value ? 'active' : ''} onClick={() => session.setSpeed(value)}>
            {value === 0 ? t('speed.pause') : `${value}×`}
          </button>
        ))}
      </div>

      <button onClick={onOpenChat}>
        💬 {t('topbar.chat')}
        {attention > 0 ? <span className="badge-count">{attention}</span> : null}
      </button>
      <LanguageSelect />
      <button onClick={onNewGame}>{t('topbar.newGame')}</button>
    </header>
  );
}
