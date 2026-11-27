import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseRuleset, defaultMedals, rulesetWithMedals } from '@supremacy/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { formatAmount, formatCount } from '../format';
import { buildingName, medalName, playerName, resourceName, unitName } from '../labels';
import { formatMessage, messageForms, placeholdersOf, type Message } from './core';
import { en } from './en';
import { DEFAULT_LOCALE, LOCALES, getLocale, hasMessage, isLocale, localeOptions, setLocale, t, tOr, type Locale } from './index';

afterEach(() => setLocale(DEFAULT_LOCALE));

const codes = Object.keys(LOCALES) as Locale[];
const enMessages = en as Record<string, Message>;

describe('the catalogs', () => {
  it('has English as the default language', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALES.en.messages).toBe(en);
  });

  it.each(codes)('%s has a well-formed registry entry', (code) => {
    expect(code).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
    expect(LOCALES[code].name.length).toBeGreaterThan(0);
    const dir = (LOCALES[code] as { dir?: string }).dir;
    expect([undefined, 'ltr', 'rtl']).toContain(dir);
  });

  it.each(codes)('%s has no key that English does not have, and (if complete) none missing', (code) => {
    const keys = Object.keys(LOCALES[code].messages);
    expect(keys.filter((k) => !(k in en))).toEqual([]);
    // The bundled languages are complete; a work in progress would be typed Partial and listed here.
    expect(Object.keys(en).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each(codes)('%s keeps the placeholders of every message', (code) => {
    const messages = LOCALES[code].messages as Record<string, Message | undefined>;
    for (const [key, reference] of Object.entries(enMessages)) {
      const translated = messages[key];
      if (translated === undefined) continue;
      expect([key, [...placeholdersOf(translated)].sort()]).toEqual([key, [...placeholdersOf(reference)].sort()]);
    }
  });

  it.each(codes)('%s has non-empty texts and plural messages with an "other" form', (code) => {
    const messages = LOCALES[code].messages as Record<string, Message | undefined>;
    for (const [key, message] of Object.entries(messages)) {
      if (message === undefined) continue;
      for (const form of messageForms(message)) expect([key, form.trim().length > 0]).toEqual([key, true]);
      if (typeof message !== 'string') expect([key, typeof message.other]).toEqual([key, 'string']);
    }
  });

  it('uses a plural message whenever the text depends on a "count"', () => {
    for (const [key, message] of Object.entries(enMessages)) {
      if (typeof message === 'string' && placeholdersOf(message).has('count') && !key.startsWith('unit.')) {
        // `{count}` in a plain string is fine for quantities ("{count} × {unit}"), but not for "tick(s)" wording.
        expect(message).not.toMatch(/\bticks?\b/i);
      }
    }
  });
});

describe('formatMessage', () => {
  it('fills in placeholders and leaves unknown ones visible', () => {
    expect(formatMessage('Hello {name}, {n} left, {missing}', 'en', { name: 'Ada', n: 3 })).toBe('Hello Ada, 3 left, {missing}');
  });

  it('chooses the plural form by the rules of the language', () => {
    const files: Message = { one: '{count} file', other: '{count} files' };
    expect(formatMessage(files, 'en', { count: 1 })).toBe('1 file');
    expect(formatMessage(files, 'en', { count: 2 })).toBe('2 files');
    expect(formatMessage(files, 'en', { count: 0 })).toBe('0 files');
  });

  it('supports languages with more than two forms', () => {
    const files: Message = { one: '{count} файл', few: '{count} файла', many: '{count} файлов', other: '{count} файла' };
    expect(formatMessage(files, 'ru', { count: 1 })).toBe('1 файл');
    expect(formatMessage(files, 'ru', { count: 3 })).toBe('3 файла');
    expect(formatMessage(files, 'ru', { count: 5 })).toBe('5 файлов');
    expect(formatMessage(files, 'ru', { count: 21 })).toBe('21 файл');
  });

  it('falls back to "other" when a form is missing', () => {
    expect(formatMessage({ other: 'x {count}' }, 'en', { count: 1 })).toBe('x 1');
  });
});

describe('t, tOr and setLocale', () => {
  it('starts in English and switches language', () => {
    expect(getLocale()).toBe('en');
    expect(t('topbar.newGame')).toBe('New game');
    setLocale('it');
    expect(getLocale()).toBe('it');
    expect(t('topbar.newGame')).toBe('Nuova partita');
  });

  it('knows which codes are languages', () => {
    expect(isLocale('it')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isLocale('toString')).toBe(false);
    expect(localeOptions().map((o) => o.code)).toEqual(codes);
  });

  it('picks the plural form of the current language', () => {
    expect(t('spy.travelling', { count: 1 })).toBe('Your spy arrives in 1 tick');
    expect(t('spy.travelling', { count: 4 })).toBe('Your spy arrives in 4 ticks');
  });

  it('falls back to English for a message the language lacks', () => {
    const messages = LOCALES.it.messages as Record<string, Message | undefined>;
    const saved = messages['spy.title'];
    delete messages['spy.title'];
    try {
      setLocale('it');
      expect(t('spy.title')).toBe('Espionage');
      expect(hasMessage('spy.title')).toBe(true);
    } finally {
      messages['spy.title'] = saved;
    }
  });

  it('uses the fallback text for keys that exist nowhere', () => {
    expect(hasMessage('unit.zeppelin')).toBe(false);
    expect(tOr('unit.zeppelin', 'Zeppelin')).toBe('Zeppelin');
  });

  it('writes numbers the way the language does', () => {
    expect(formatAmount(12345)).toBe('12.3k');
    expect(formatCount(2.5)).toBe('2.5');
    setLocale('it');
    expect(formatAmount(12345)).toBe('12,3k');
    expect(formatCount(2.5)).toBe('2,5');
    expect(formatAmount(1_500_000)).toBe('1,5M');
  });
});

describe('names that come from the game data', () => {
  const rules = rulesetWithMedals(
    baseRuleset,
    defaultMedals.map((m) => m.id),
  );

  it.each(codes)('%s translates every unit, building, resource and medal', (code) => {
    const messages = LOCALES[code].messages as Record<string, Message | undefined>;
    const missing: string[] = [];
    for (const id of Object.keys(rules.units)) if (!messages[`unit.${id}`]) missing.push(`unit.${id}`);
    for (const id of Object.keys(rules.buildings)) if (!messages[`building.${id}`]) missing.push(`building.${id}`);
    for (const id of rules.resources) if (!messages[`resource.${id}`]) missing.push(`resource.${id}`);
    for (const medal of defaultMedals) {
      if (!messages[`medal.${medal.id}.name`]) missing.push(`medal.${medal.id}.name`);
      if (!messages[`medal.${medal.id}.description`]) missing.push(`medal.${medal.id}.description`);
    }
    expect(missing).toEqual([]);
  });

  it('translates them, and falls back to the name in the rules for new content', () => {
    expect(unitName(rules, 'infantry')).toBe('Infantry');
    expect(buildingName(rules, 'port')).toBe('Port');
    expect(resourceName('grain')).toBe('Grain');
    setLocale('it');
    expect(unitName(rules, 'infantry')).toBe('Fanteria');
    expect(buildingName(rules, 'port')).toBe('Porto');
    expect(resourceName('grain')).toBe('Grano');
    expect(medalName({ id: 'generals', name: 'Generals' })).toBe('Generali');

    const custom = { ...rules, units: { ...rules.units, zeppelin: { ...rules.units.infantry!, name: 'Zeppelin' } } };
    expect(unitName(custom, 'zeppelin')).toBe('Zeppelin');
    expect(unitName(rules, 'unknown-id')).toBe('unknown-id');
  });

  it('translates the two sides, and shows any other player as stored', () => {
    const players = [
      { id: 'red', name: 'Red Empire' },
      { id: 'blue', name: 'Blue Republic' },
      { id: 'green', name: 'Greens' },
    ];
    expect(playerName(players, 'red')).toBe('Red Empire');
    setLocale('it');
    expect(playerName(players, 'red')).toBe('Impero Rosso');
    expect(playerName(players, 'green')).toBe('Greens');
    expect(playerName(players, null)).toBe('Nessuno');
  });
});

describe('error codes', () => {
  /** Every `error: 'code'` the simulator can return. */
  function simErrorCodes(): string[] {
    const dir = join(__dirname, '../../../sim/src');
    const found = new Set<string>();
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) {
          for (const match of readFileSync(path, 'utf8').matchAll(/error: '([a-z_]+)'/g)) found.add(match[1] as string);
        }
      }
    };
    walk(dir);
    return [...found].sort();
  }

  it('are all translated, in every language', () => {
    const codesInSim = simErrorCodes();
    expect(codesInSim.length).toBeGreaterThan(20);
    for (const code of codes) {
      const messages = LOCALES[code].messages as Record<string, Message | undefined>;
      expect([code, codesInSim.filter((c) => !messages[`error.${c}`])]).toEqual([code, []]);
    }
  });
});
