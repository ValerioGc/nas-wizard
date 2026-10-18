import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '@/i18n';
import it_ from '@/i18n/it';
import en from '@/i18n/en';
import type { TranslationCatalog } from '@/types/types';

function texts(catalog: TranslationCatalog, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string' ? [[path, value]] : Object.entries(texts(value, path));
    }),
  );
}

const italian = texts(it_);
const english = texts(en);

afterEach(() => setLocale('it'));

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'tests' ? [] : sources(path);
    }
    return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
  });
}

describe('the catalogs of the wizard', () => {
  it('declare the same keys in Italian and in English', () => {
    expect(Object.keys(italian).sort()).toEqual(Object.keys(english).sort());
  });

  it('use the same interpolation parameters in both languages', () => {
    const parameters = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
    for (const [key, value] of Object.entries(italian)) {
      expect(parameters(value), key).toEqual(parameters(english[key] ?? ''));
    }
  });

  it('have a text for every key the interface asks for by name', () => {
    const used = sources(join(__dirname, '../..')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)].map(([, key]) => key),
    );

    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(Object.keys(italian), key).toContain(key);
    }
  });

  it('resolve nested texts using the selected language', () => {
    setLocale('it');
    expect(t('account.fields.username')).toBe('Nome utente');
    setLocale('en');
    expect(t('account.fields.username')).toBe('Username');
    expect(t('install.steps.downloadGateway')).toBe('Downloading the gateway');
  });

  it('interpolate nested texts and preserve parameters that were not provided', () => {
    setLocale('en');
    expect(t('common.stepOf', { step: 2, total: 6 })).toBe('Step 2 of 6');
    expect(t('account.validation.length', { min: 3, max: 25 })).toBe(
      'Between 3 and 25 characters are required.',
    );
    expect(t('network.connectedTo', { name: 'Home' })).toBe('Connected to Home');
    expect(t('common.stepOf', { step: 2 })).toBe('Step 2 of {total}');
  });

  it('return the requested path for missing texts and branches', () => {
    for (const key of [
      'missing.text',
      'account.missing',
      'account.fields',
      'welcome.title.extra',
      'common.toString',
      '__proto__',
    ]) {
      expect(t(key)).toBe(key);
    }
  });
});
