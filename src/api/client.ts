import { t } from '@/i18n';

/**
 * Sends a request to the API of the wizard and returns what it answers.
 * @param path - The path, after `/api`.
 * @param options - The fetch options, such as method and body.
 * @returns A promise that resolves to the answer; a failure rejects with the reason the wizard gave.
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const reason =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : '';

    throw new Error(reason || t('common.requestFailed'));
  }

  return (await response.json()) as T;
}
