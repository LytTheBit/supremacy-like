import { en } from './en';
import { it } from './it';
import type { Catalog } from './en';

/**
 * The languages of the interface.
 *
 * To add a language:
 *  1. copy `en.ts` to `<code>.ts` (e.g. `de.ts`), type it as `Catalog` and translate the values;
 *  2. import it here and add one entry below.
 *
 * That is all: the language selector, the saved choice and the browser-language detection pick it
 * up from this list. While a translation is unfinished, type it as `Partial<Catalog>`: the
 * missing messages are shown in English.
 */
export interface LocaleInfo {
  /** Name of the language in that language (shown in the selector). */
  name: string;
  /** Text direction. Default 'ltr'. */
  dir?: 'ltr' | 'rtl';
  messages: Partial<Catalog>;
}

export const LOCALES = {
  en: { name: 'English', messages: en },
  it: { name: 'Italiano', messages: it },
} as const satisfies Record<string, LocaleInfo>;

export type Locale = keyof typeof LOCALES;

/** The language every missing message falls back to. */
export const DEFAULT_LOCALE: Locale = 'en';
