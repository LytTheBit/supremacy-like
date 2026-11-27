import { findRelationship, type GameState, type TreatyKind } from '@supremacy/sim';
import { useState } from 'react';
import { bundleIsEmpty, parseBundle } from '../chat-model';
import { resourceIcon } from '../icons';
import { t, useLocale } from '../i18n';
import { errorText, playerName, resourceName } from '../labels';
import { HUMAN_ID, type GameSession } from '../session';

interface DealFormProps {
  session: GameSession;
  state: GameState;
  /** The other player of the chat. */
  other: string;
  onDone: () => void;
  onCancel: () => void;
}

type Mode = 'trade' | 'gift';

/**
 * The offer form of a chat: an agreement (truce, alliance), resources and money, and provinces,
 * given and asked for. In "gift" mode nothing is asked and what is given arrives at once.
 */
export function DealForm({ session, state, other, onDone, onCancel }: DealFormProps) {
  useLocale();
  const resources = session.rules.resources;
  const [mode, setMode] = useState<Mode>('trade');
  const [treaty, setTreaty] = useState<TreatyKind | ''>('');
  const [giveAmounts, setGiveAmounts] = useState<Record<string, string>>({});
  const [wantAmounts, setWantAmounts] = useState<Record<string, string>>({});
  const [giveProvinces, setGiveProvinces] = useState<Set<string>>(new Set());
  const [wantProvinces, setWantProvinces] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const relation = findRelationship(state, HUMAN_ID, other);
  const status = relation?.kind ?? 'war';
  const warPending = relation?.warAt !== undefined;
  const treatyChoices: TreatyKind[] = warPending || status === 'alliance' ? [] : ['truce', 'alliance'];

  const mine = state.provinces.filter((p) => p.owner === HUMAN_ID);
  const theirs = state.provinces.filter((p) => p.owner === other);

  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const submit = () => {
    const give = parseBundle(giveAmounts, giveProvinces);
    const want = mode === 'gift' ? { resources: {}, provinces: [] } : parseBundle(wantAmounts, wantProvinces);
    const hasDeal = !bundleIsEmpty(give) || !bundleIsEmpty(want);
    if (!hasDeal && treaty === '') {
      setError(t('deal.nothing'));
      return;
    }
    // The agreement and the deal are two offers, shown as two cards in the same chat.
    if (treaty !== '') {
      const result = session.propose(other, treaty);
      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }
    }
    if (hasDeal) {
      const result = mode === 'gift' ? session.gift(other, give) : session.offerTrade(other, give, want);
      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }
    }
    onDone();
  };

  const amountsEditor = (values: Record<string, string>, update: (next: Record<string, string>) => void) => (
    <div className="deal-amounts">
      {resources.map((resource) => (
        <label key={resource}>
          <span>
            <span aria-hidden>{resourceIcon(resource)}</span> {resourceName(resource)}
          </span>
          <input
            type="number"
            min={0}
            step={500}
            inputMode="numeric"
            value={values[resource] ?? ''}
            placeholder="0"
            onChange={(e) => update({ ...values, [resource]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );

  const provincesEditor = (list: typeof mine, picked: Set<string>, update: (next: Set<string>) => void) =>
    list.length === 0 ? (
      <p className="muted small">{t('deal.noProvinces')}</p>
    ) : (
      <div className="chips">
        {list.map((province) => (
          <button
            key={province.id}
            type="button"
            className={`chip ${picked.has(province.id) ? 'active' : ''}`}
            onClick={() => toggle(picked, province.id, update)}
          >
            {session.provinceName(province.id)}
          </button>
        ))}
      </div>
    );

  return (
    <div className="deal-form">
      <div className="deal-head">
        <strong>{t('deal.title')}</strong>
        <div className="chips">
          {(['trade', 'gift'] as const).map((value) => (
            <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>
              {t(`deal.mode.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="deal-section">
        <h4>{t('deal.treaty')}</h4>
        {warPending ? (
          <p className="muted small">{t('deal.warPending')}</p>
        ) : (
          <div className="chips">
            <button type="button" className={treaty === '' ? 'active' : ''} onClick={() => setTreaty('')}>
              {t('deal.treaty.none')}
            </button>
            {treatyChoices.map((kind) => (
              <button key={kind} type="button" className={treaty === kind ? 'active' : ''} onClick={() => setTreaty(kind)}>
                {kind === 'truce' && status === 'truce' ? t('deal.treaty.renewTruce') : t(`chat.treaty.${kind}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="deal-columns">
        <div className="deal-section">
          <h4>{t('deal.give')}</h4>
          {amountsEditor(giveAmounts, setGiveAmounts)}
          <div className="muted small">{t('deal.provinces')}</div>
          {provincesEditor(mine, giveProvinces, setGiveProvinces)}
        </div>
        {mode === 'trade' ? (
          <div className="deal-section">
            <h4>{t('deal.want')}</h4>
            {amountsEditor(wantAmounts, setWantAmounts)}
            <div className="muted small">
              {t('deal.provinces')} · {playerName(state.players, other)}
            </div>
            {provincesEditor(theirs, wantProvinces, setWantProvinces)}
          </div>
        ) : null}
      </div>

      {error ? <p className="error small">{error}</p> : null}
      <div className="chips">
        <button className="primary" onClick={submit}>
          {mode === 'gift' && treaty === '' ? t('deal.sendGift') : t('deal.send')}
        </button>
        <button onClick={onCancel}>{t('deal.cancel')}</button>
      </div>
    </div>
  );
}
