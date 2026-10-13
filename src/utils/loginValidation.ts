import { t } from '@/i18n';

const USERNAME_LENGTH = { min: 3, max: 25 };
const PASSWORD_LENGTH = { min: 8, max: 128 };

function validate(value: string, label: string, length: { min: number; max: number }) {
  if (!value.trim()) {
    return t('fieldRequired', { field: t(label) });
  }

  if (value.length < length.min || value.length > length.max) {
    return t('fieldLength', length);
  }

  return '';
}

export function validateLogin(username: string, password: string) {
  return {
    username: validate(username.trim(), 'fieldUsername', USERNAME_LENGTH),
    password: validate(password, 'fieldPassword', PASSWORD_LENGTH),
  };
}

/**
 * Whether the launcher can take the name as the hostname of the NAS: letters, digits and dashes, up
 * to 63, starting and ending with a letter or a digit.
 */
export function isNasName(value: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(value.trim());
}

/**
 * Validates the account creation fields: username, password, and password confirmation.
 */
export function validateAccount(username: string, password: string, confirm: string) {
  const errors = validateLogin(username, password);
  const name = username.trim();
  const systemName = name.toLowerCase().replaceAll('.', '_');
  const allowed = /^[A-Za-z_][\w.-]*$/.test(name);
  let usernameError = errors.username;
  if (!usernameError) {
    if (!allowed) {
      usernameError = t('usernameCharacters');
    } else if (['nas', 'nas-os', 'root'].includes(systemName)) {
      usernameError = t('usernameUnavailable');
    }
  }

  return {
    username: usernameError,
    password: errors.password,
    confirm: password === confirm ? '' : t('passwordMismatch'),
  };
}

export function isToken(value: string) {
  return /^[\x21-\x7e]{1,512}$/.test(value.trim());
}
