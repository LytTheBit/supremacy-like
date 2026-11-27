import { useSyncExternalStore } from 'react';
import { formatMessage, type Message, type Params } from './core';
import { en, type MessageKey } from './en';
import { DEFAULT_LOCALE, LOCALES, type Locale, type LocaleInfo } from './locales';

export type { Message, Params, PluralMessage } from './core';
export type { Catalog, MessageKey } from './en';
export { DEFAULT_LOCALE, LOCALES, type Locale } from './locales';

const STORAGE_KEY = 'supremacy-like.locale';

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function isLocale(code: string): code is Locale {
  return Object.prototype.hasOwnProperty.call(LOCALES, code);
}

export function getLocale(): Locale {
  return current;
}

/** The languages the player can pick, for the selector. */
export function localeOptions(): { code: Locale; name: string }[] {
  return (Object.keys(LOCALES) as Locale[]).map((code) => ({ code, name: LOCALES[code].name }));
}

/** Changes the language of the interface: persists the choice and re-renders whatever uses `useLocale`. */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode or no storage: the choice just is not remembered.
  }
  applyToDocument();
  for (const listener of [...listeners]) listener();
}

/** Keeps `<html lang dir>` in step with the language (screen readers, hyphenation, right-to-left). */
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  const info: LocaleInfo = LOCALES[current];
  document.documentElement.lang = current;
  document.documentElement.dir = info.dir ?? 'ltr';
}

/** The saved choice, else the first browser language we have, else the default. */
export function detectLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && isLocale(saved)) return saved;
  } catch {
    // Ignore: no storage.
  }
  const preferred = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0] ?? '';
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

/** Call once at startup, in the browser. (Importing this module never touches the browser, so tests stay in English.) */
export function initLocale(): void {
  current = detectLocale();
  applyToDocument();
}

function lookup(key: string): Message | undefined {
  const own = LOCALES[current].messages as Record<string, Message | undefined>;
  return own[key] ?? (en as Record<string, Message | undefined>)[key];
}

/** True when a message exists (in the current language or in the English fallback). */
export function hasMessage(key: string): boolean {
  return lookup(key) !== undefined;
}

/** Translates a message. A key that exists nowhere shows up as itself, which is easy to spot. */
export function t(key: MessageKey, params?: Params): string {
  return tOr(key, key, params);
}

/**
 * Like `t` for keys built at runtime (`unit.${id}`), with a fallback text for ids that have no
 * translation (a new unit in the rules, a medal added later).
 */
export function tOr(key: string, fallback: string, params?: Params): string {
  const message = lookup(key);
  return message === undefined ? fallback : formatMessage(message, current, params);
}

/** Subscribes a component to language changes. Use it in every component that calls `t`. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => current, // server rendering (the map snapshot script)
  );
}
