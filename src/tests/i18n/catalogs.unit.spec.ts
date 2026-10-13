import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import it_ from '@/i18n/it';
import en from '@/i18n/en';

/** Every source file of the interface, tests excluded. */
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
    expect(Object.keys(it_).sort()).toEqual(Object.keys(en).sort());
  });

  it('have a text for every key the interface asks for by name', () => {
    const used = sources(join(__dirname, '../..')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(\w+)'/g)].map(([, key]) => key),
    );

    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(Object.keys(it_), key).toContain(key);
    }
  });
});
