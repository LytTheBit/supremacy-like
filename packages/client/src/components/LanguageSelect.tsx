import { isLocale, localeOptions, setLocale, t, useLocale } from '../i18n';

/** Picks the language of the interface. The list comes from the registry in `i18n/locales.ts`. */
export function LanguageSelect() {
  const locale = useLocale();
  return (
    <label className="language">
      <span className="visually-hidden">{t('language.label')}</span>
      <select
        value={locale}
        aria-label={t('language.label')}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
      >
        {localeOptions().map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
