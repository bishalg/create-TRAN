// Verifies: REQ-OBS-001
import * as api from '@tran/api';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('REQ-OBS-001: @tran/core has no trace implementation of its own', () => {
  it('re-exports the one pinned by fixtures/trace.json', () => {
    for (const name of [
      'parseTraceparent',
      'formatTraceparent',
      'newTrace',
      'childSpan',
      'startTrace',
      'nextSpan',
      'requestSpan',
    ] as const) {
      expect(core[name], name).toBe(api[name]);
    }
  });
});
