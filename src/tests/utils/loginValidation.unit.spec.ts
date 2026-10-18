import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import { isToken, validateAccount, validateLogin } from '@/utils/loginValidation';

beforeEach(() => setLocale('en'));

describe('account validation', () => {
  it('asks the sign-in for a name of 3 to 25 characters and a password of 8 to 128', () => {
    expect(validateLogin('admin', 'long enough')).toEqual({ username: '', password: '' });
    expect(validateLogin('ab', 'short')).toEqual({
      username: 'Between 3 and 25 characters are required.',
      password: 'Between 8 and 128 characters are required.',
    });
  });

  it('asks the wizard for a plain name and the same password twice', () => {
    expect(validateAccount(' admin.nas ', 'long enough', 'long enough')).toEqual({
      username: '',
      password: '',
      confirm: '',
    });
    expect(validateAccount('ad min', 'long enough', 'long enougj')).toMatchObject({
      username:
        'The name starts with a letter or an underscore and contains letters, numbers, dots, hyphens or underscores.',
      confirm: 'The two passwords do not match.',
    });
  });

  it('keeps the terminal user separate from system accounts', () => {
    expect(validateAccount('nas', 'long enough', 'long enough').username).toBe(
      'Name reserved by the operating system.',
    );
    expect(validateAccount('9lives', 'long enough', 'long enough').username).toBe(
      'The name starts with a letter or an underscore and contains letters, numbers, dots, hyphens or underscores.',
    );
  });

  it('takes one word of printable characters as a token', () => {
    expect(isToken(' ghp_abc123 ')).toBe(true);
    expect(isToken('')).toBe(false);
    expect(isToken('two words')).toBe(false);
    expect(isToken('x'.repeat(513))).toBe(false);
  });
});
