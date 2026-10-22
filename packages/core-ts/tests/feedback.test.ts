// Verifies: REQ-ERR-001 REQ-ERR-004 REQ-ERR-005 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-LOAD-001
/**
 * `fixtures/feedback.json` against the generated catalogue (`src/generated/feedback.ts`) and the
 * small functions over it (`src/feedback.ts`) — the same file pins Rust, Swift and Kotlin.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOGUE,
  actionSpec,
  codeForHttpStatus,
  ERROR_CATALOGUE,
  errorCodeFromWire,
  errorSpec,
  LOADING_POLICY,
  RETRY_POLICY,
  retryAfterMs,
  retryDelayMs,
  TOAST_DURATIONS_MS,
  VERDICT_SOURCES,
  verdictSourceMessageKey,
  type VerdictSource,
} from '../src/feedback.js';
import { designMotion } from '../src/tokens.js';
import tokensJson from '../src/generated/tokens.json' with { type: 'json' };

interface FeedbackFixtures {
  toastDurationsMs: Record<string, number>;
  retryPolicy: Record<string, number>;
  retryDelays: { retry: number; random: number; expectedMs: number }[];
  retryAfter: { header: string; expectedMs: number | null }[];
  errors: { code: string }[];
  statusFallback: { status: number; code: string }[];
  actions: { action: string }[];
  loadingPolicy: { indicatorDelayMs: number; pendingMessageKey: string };
  verdictSources: { source: VerdictSource; messageKey: string }[];
}

const fixtures: FeedbackFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/feedback.json', import.meta.url), 'utf8')
);

describe('feedback catalogue (shared with Rust and native)', () => {
  it('the generated error catalogue is the fixture, in order', () => {
    expect(ERROR_CATALOGUE).toEqual(fixtures.errors);
  });

  it('the generated action catalogue is the fixture, in order', () => {
    expect(ACTION_CATALOGUE).toEqual(fixtures.actions);
  });

  it('toast durations and the retry policy match', () => {
    expect(TOAST_DURATIONS_MS).toEqual(fixtures.toastDurationsMs);
    expect(RETRY_POLICY).toEqual(fixtures.retryPolicy);
  });

  it.each(fixtures.retryDelays)(
    'retryDelayMs($retry, $random) = $expectedMs',
    ({ retry, random, expectedMs }) => {
      expect(retryDelayMs(retry, random)).toBe(expectedMs);
    }
  );

  it.each(fixtures.retryAfter)('retryAfterMs($header) = $expectedMs', ({ header, expectedMs }) => {
    expect(retryAfterMs(header)).toBe(expectedMs);
  });

  it.each(fixtures.statusFallback)('HTTP $status without a code is $code', ({ status, code }) => {
    expect(codeForHttpStatus(status)).toBe(code);
  });

  it('statuses outside 400–599 are server.internal', () => {
    expect(codeForHttpStatus(302)).toBe('server.internal');
    expect(codeForHttpStatus(600)).toBe('server.internal');
  });

  it('looks specs up by code and action, and parses wire codes', () => {
    expect(errorSpec('network.offline').presentation).toEqual({ kind: 'banner' });
    expect(actionSpec('sign_out').presentation).toEqual({ kind: 'dialog', destructive: true });
    expect(errorCodeFromWire('route.not_found')).toBe('route.not_found');
    expect(errorCodeFromWire('from.a.newer.server')).toBeUndefined();
    expect(errorCodeFromWire(undefined)).toBeUndefined();
  });
});

describe('waiting policy (shared with Rust and native)', () => {
  it('[REQ-LOAD-001] LOADING_POLICY and VERDICT_SOURCES match fixtures/feedback.json', () => {
    expect(LOADING_POLICY).toEqual(fixtures.loadingPolicy);
    expect(VERDICT_SOURCES).toEqual(fixtures.verdictSources);
  });

  it('[REQ-LOAD-001] verdictSourceMessageKey covers every source', () => {
    for (const row of fixtures.verdictSources) {
      expect(verdictSourceMessageKey(row.source)).toBe(row.messageKey);
    }
    expect(verdictSourceMessageKey('device_fallback')).toBe('eligibility.result.sourceFallback');
  });

  it('[REQ-LOAD-006] designMotion is the generated tokens.json motion', () => {
    expect(designMotion).toEqual(tokensJson.motion);
    expect(designMotion).toEqual({ fast: '150ms', base: '250ms' });
  });
});
