import { getThemeTokens as shared } from '@tran/core';
import { describe, expect, it } from 'vitest';
import { getThemeTokens } from '../src/generated/brandTokens.js';

describe('native design tokens', () => {
  it('re-exports the shared tokens so web and native cannot drift', () => {
    expect(getThemeTokens).toBe(shared);
  });
});
