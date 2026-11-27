import { defaultMedals } from '@supremacy/sim';
import { useState } from 'react';
import { t, useLocale } from '../i18n';
import { medalDescription, medalName } from '../labels';
import type { SessionOptions } from '../session';
import { LanguageSelect } from './LanguageSelect';

interface NewGameProps {
  onStart: (options: SessionOptions) => void;
}

export function NewGame({ onStart }: NewGameProps) {
  useLocale();
  const [seed, setSeed] = useState(7);
  const [provinces, setProvinces] = useState(24);
  const [medals, setMedals] = useState<string[]>([]);
  const [organic, setOrganic] = useState(0.6);
  const [fog, setFog] = useState(true);
  const [sea, setSea] = useState(false);

  const toggle = (id: string) =>
    setMedals((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));

  return (
    <div className="newgame">
      <div className="card">
        <LanguageSelect />
        <h1>{t('app.title')}</h1>
        <p className="muted">{t('newgame.intro')}</p>

        <label className="field">
          {t('newgame.seed')}
          <span className="inline">
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} />
            <button onClick={() => setSeed(Math.floor(Math.random() * 100000))}>{t('newgame.random')}</button>
          </span>
        </label>

        <label className="field">
          {t('newgame.provinces')}
          <select value={provinces} onChange={(event) => setProvinces(Number(event.target.value))}>
            {[12, 18, 24, 32].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          {t('newgame.organic', { percent: Math.round(organic * 100) })}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={organic}
            onChange={(event) => setOrganic(Number(event.target.value))}
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={fog} onChange={() => setFog((value) => !value)} />
          <span>
            <strong>{t('newgame.fog.title')}</strong>
            <span className="muted small"> {t('newgame.fog.description')}</span>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={sea} onChange={() => setSea((value) => !value)} />
          <span>
            <strong>{t('newgame.sea.title')}</strong>
            <span className="muted small"> {t('newgame.sea.description')}</span>
          </span>
        </label>

        <div className="field">
          {t('newgame.medals')}
          {defaultMedals.map((medal) => (
            <label className="check" key={medal.id}>
              <input type="checkbox" checked={medals.includes(medal.id)} onChange={() => toggle(medal.id)} />
              <span>
                <strong>{medalName(medal)}</strong>
                <span className="muted small"> {medalDescription(medal)}</span>
              </span>
            </label>
          ))}
        </div>

        <button className="primary big" onClick={() => onStart({ seed, provinces, medals, organic, fog, sea })}>
          {t('newgame.start')}
        </button>
      </div>
    </div>
  );
}
