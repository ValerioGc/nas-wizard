import { readonly, ref } from 'vue';
import type { Locale } from '@/types/types';

import it from './it';
import en from './en';

export type { Locale };

const catalogs: Record<Locale, Record<string, string>> = { it, en };

const current = ref<Locale>('it');
export const locale = readonly(current);

/**
 * Switches language, ignoring anything that is not one of the languages that exist.
 */
export function setLocale(value: Locale) {
  if (!Object.hasOwn(catalogs, value)) {
    return;
  }

  current.value = value;
  document.documentElement.lang = value;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const catalog = catalogs[current.value];
  return (catalog[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    String(params[name] ?? match),
  );
}
