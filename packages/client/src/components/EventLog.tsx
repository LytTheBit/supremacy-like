import type { LogEntry } from '../log';
import { t, useLocale } from '../i18n';

export function EventLog({ log }: { log: LogEntry[] }) {
  useLocale();
  const recent = [...log].reverse().slice(0, 40);
  return (
    <div className="card log">
      <h3>{t('log.title')}</h3>
      {recent.length === 0 ? <p className="muted">{t('log.empty')}</p> : null}
      <ul className="plain">
        {recent.map((entry) => (
          <li key={entry.id} className={`tone-${entry.tone}`}>
            <span className="muted">t{entry.tick}</span> {entry.text()}
          </li>
        ))}
      </ul>
    </div>
  );
}
