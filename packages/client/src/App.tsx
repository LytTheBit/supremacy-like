import { directChatId, findArmyPath, type ProvinceId } from '@supremacy/sim';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChatModal } from './components/ChatModal';
import { DiplomacyPanel } from './components/DiplomacyPanel';
import { EventLog } from './components/EventLog';
import { Inspector } from './components/Inspector';
import { MapView } from './components/MapView';
import { MarketPanel } from './components/MarketPanel';
import { NewGame } from './components/NewGame';
import { TopBar } from './components/TopBar';
import { t, useLocale } from './i18n';
import { playerName } from './labels';
import { HUMAN_ID, GameSession, type SessionOptions } from './session';

export function App() {
  useLocale();
  const [session, setSession] = useState<GameSession | null>(null);

  if (!session) {
    return <NewGame onStart={(options: SessionOptions) => setSession(new GameSession(options))} />;
  }
  return <GameScreen key={session.options.seed} session={session} onNewGame={() => setSession(null)} />;
}

function GameScreen({ session, onNewGame }: { session: GameSession; onNewGame: () => void }) {
  useLocale();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { state, speed } = snapshot;
  const visible = useMemo(() => new Set(snapshot.visible), [snapshot.visible]);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceId | null>(null);
  const [selectedArmy, setSelectedArmy] = useState<string | null>(null);
  // The Chat window: closed (null), or open on a chat id (the empty string means the first conversation).
  const [chat, setChat] = useState<string | null>(null);
  const openChatWith = (playerId: string) => setChat(directChatId(HUMAN_ID, playerId));

  // The game clock: one tick every 1000 / speed milliseconds.
  useEffect(() => {
    if (speed <= 0 || state.outcome) return;
    const timer = setInterval(() => session.step(), 1000 / speed);
    return () => clearInterval(timer);
  }, [session, speed, state.outcome]);

  // An army that no longer exists (destroyed or merged) is no longer selected.
  const army = state.armies.find((a) => a.id === selectedArmy) ?? null;

  // Route preview: from our selected army to the selected province.
  const previewPath =
    army && army.owner === HUMAN_ID && selectedProvince !== null && selectedProvince !== army.location
      ? (findArmyPath(state, session.rules, army, selectedProvince)?.path ?? [])
      : [];

  const selectArmy = (id: string) => {
    setSelectedArmy(id);
    const target = state.armies.find((a) => a.id === id);
    if (target) setSelectedProvince(target.location);
  };

  const outcome = state.outcome;
  const winnerNames = outcome ? outcome.winners.map((id) => playerName(state.players, id)).join(', ') : '';

  return (
    <div className="app">
      <TopBar session={session} snapshot={snapshot} onNewGame={onNewGame} onOpenChat={() => setChat('')} />
      <div className="main">
        <div className="map">
          <MapView
            session={session}
            state={state}
            visible={visible}
            selectedProvince={selectedProvince}
            selectedArmy={army ? army.id : null}
            previewPath={previewPath}
            onSelectProvince={setSelectedProvince}
            onSelectArmy={selectArmy}
          />
          {outcome ? (
            <div className="overlay">
              <div className="card">
                <h2>
                  {outcome.winners.includes(HUMAN_ID)
                    ? t('outcome.victory')
                    : outcome.winners.length === 0
                      ? t('outcome.draw')
                      : t('outcome.defeat')}
                </h2>
                <p>
                  {outcome.winners.length > 0
                    ? t('outcome.summary', {
                        winner: t('outcome.winner', { count: outcome.winners.length, names: winnerNames }),
                        reason: t(`outcome.reason.${outcome.reason}`),
                        tick: state.tick,
                      })
                    : t('outcome.summaryNoWinner', { reason: t(`outcome.reason.${outcome.reason}`), tick: state.tick })}
                </p>
                <button className="primary" onClick={onNewGame}>
                  {t('topbar.newGame')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <aside className="sidebar">
          <DiplomacyPanel session={session} state={state} chatRead={snapshot.chatRead} onOpenChat={openChatWith} />
          <MarketPanel session={session} state={state} />
          <Inspector
            session={session}
            state={state}
            visible={visible}
            selectedProvince={selectedProvince}
            selectedArmy={army ? army.id : null}
            onSelectArmy={selectArmy}
          />
          <EventLog log={snapshot.log} />
        </aside>
      </div>
      {chat !== null ? (
        <ChatModal
          session={session}
          state={state}
          chatRead={snapshot.chatRead}
          initialChat={chat === '' ? null : chat}
          onClose={() => setChat(null)}
        />
      ) : null}
    </div>
  );
}
