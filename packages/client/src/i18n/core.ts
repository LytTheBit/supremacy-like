/**
 * Framework-free pieces of the translation system: message shapes, `{name}` interpolation and
 * plural selection. Nothing here knows about React or about which languages exist.
 */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * A message that depends on a number. The number is the `count` parameter; the form is chosen
 * with the plural rules of the language (`Intl.PluralRules`), so languages with more than two
 * forms (Russian, Arabic, ...) just add the forms they need. `other` is always required.
 */
export type PluralMessage = Partial<Record<Exclude<PluralCategory, 'other'>, string>> & { other: string };

/** A translatable text: a string with `{placeholders}`, or plural forms of one. */
export type Message = string | PluralMessage;

export type Params = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Every string a message can show (the plural forms of a plural message). */
export function messageForms(message: Message): string[] {
  return typeof message === 'string' ? [message] : Object.values(message);
}

/** Names of the `{placeholders}` used by a message, in all its forms. */
export function placeholdersOf(message: Message): Set<string> {
  const names = new Set<string>();
  for (const form of messageForms(message)) {
    for (const match of form.matchAll(PLACEHOLDER)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** Turns a message into text: picks the plural form, then fills in the placeholders. */
export function formatMessage(message: Message, locale: string, params: Params = {}): string {
  let template: string;
  if (typeof message === 'string') {
    template = message;
  } else {
    const count = params.count;
    const category = typeof count === 'number' ? pluralCategory(locale, count) : 'other';
    template = message[category] ?? message.other;
  }
  // A placeholder with no value is left visible: it is a bug to notice, not to hide.
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
