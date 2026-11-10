// Verifies: REQ-VER-010
import { describe, expect, it } from 'vitest';
import {
  readDismissedVersion,
  rememberDismissed,
  UPDATE_PROMPT_STORAGE_KEY,
} from './updatePrompt.js';

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the dismissed update prompt', () => {
  it('is remembered per recommended version', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readDismissedVersion(storage)).toBeNull();
    rememberDismissed('1.5.0', storage);
    expect(store.get(UPDATE_PROMPT_STORAGE_KEY)).toBe('1.5.0');
    expect(readDismissedVersion(storage)).toBe('1.5.0');
  });

  it('survives storage that is missing or refuses access', () => {
    expect(readDismissedVersion(broken)).toBeNull();
    expect(() => rememberDismissed('1.5.0', broken)).not.toThrow();
    expect(readDismissedVersion(undefined)).toBeNull();
    expect(() => rememberDismissed('1.5.0', undefined)).not.toThrow();
  });
});
