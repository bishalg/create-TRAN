/**
 * The recommended version the person last answered "Not now" for (REQ-VER-010): a preference,
 * never a credential, so it may live in Web Storage beside the theme (REQ-SEC-018). Whether to ask
 * again is the Rust decision `updatePrompt`; this module only remembers the answer.
 */
export const UPDATE_PROMPT_STORAGE_KEY = 'tran.updatePromptDismissed';

export function readDismissedVersion(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage
): string | null {
  try {
    return storage?.getItem(UPDATE_PROMPT_STORAGE_KEY) ?? null;
  } catch {
    return null; // Private browsing can block storage access; the prompt then asks once per visit.
  }
}

export function rememberDismissed(
  version: string,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage
): void {
  try {
    storage?.setItem(UPDATE_PROMPT_STORAGE_KEY, version);
  } catch {
    // Storage may be unavailable; the answer then only lasts for this visit.
  }
}
