/**
 * Zero-dependency edge-compatible utilities.
 * Inspired by `dubinc/dub` (`packages/utils`).
 */

/**
 * Resilient fetch wrapper with exponential backoff retry.
 */
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = 3,
  backoffMs = 500
): Promise<T> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (res.status >= 500 && retries > 0) {
        await new Promise((r) => setTimeout(r, backoffMs));
        return fetchWithRetry<T>(url, options, retries - 1, backoffMs * 2);
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, backoffMs));
      return fetchWithRetry<T>(url, options, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}

/**
 * Extracts clean domain without protocol or www prefix.
 */
export function getCleanDomain(input: string): string {
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return input;
  }
}

/**
 * Masks sensitive keys or hashes, preserving trailing characters.
 */
export function maskSensitiveString(str: string, visibleTrailing = 4): string {
  if (str.length <= visibleTrailing) return str;
  const maskedCount = str.length - visibleTrailing;
  return '•'.repeat(maskedCount) + str.slice(-visibleTrailing);
}

/**
 * Formats a number into currency using native Intl (Edge-compatible).
 */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}
