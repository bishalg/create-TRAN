// Verifies: REQ-ERR-001 REQ-ERR-004 REQ-ERR-005 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-LOAD-001 REQ-OBS-011
/**
 * `fixtures/feedback.json` against the generated catalogue (`src/generated/feedback.ts`) and the
 * small functions over it (`src/feedback.ts`) — the same file pins Rust, Swift and Kotlin.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOGUE,
  actionSpec,
  classifyError,
  codeForHttpStatus,
  ERROR_CATALOGUE,
  errorCodeFromWire,
  errorSpec,
  LOADING_POLICY,
  LOG_EVENT,
  logFailure,
  RETRY_POLICY,
  retryAfterMs,
  retryDelayMs,
  TOAST_DURATIONS_MS,
  TranRequestError,
  VERDICT_SOURCES,
  verdictSourceMessageKey,
  type VerdictSource,
} from '../src/feedback.js';
import { setErrorReporter, type ReportEvent } from '../src/resilience.js';
import { TranApiError } from '@tran/api';
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

describe('REQ-OBS-011: Client failure trace correlation', () => {
  it('carries trace_id on request failed log event and reporter event when response arrives', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const requestId = 'req-trace-test-1';
    const logged: Record<string, unknown>[] = [];
    const reported: ReportEvent[] = [];

    setErrorReporter((event) => {
      reported.push(event);
    });

    const mockLogger = {
      debug: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      info: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      warn: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      error: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
    };

    const apiError = new TranApiError('Internal Server Error', 500, {
      code: 'server.internal',
      requestId,
      traceId,
    });

    const error = classifyError(apiError);
    expect(error.traceId).toBe(traceId);
    expect(error.requestId).toBe(requestId);

    logFailure(error, mockLogger);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.trace_id).toBe(traceId);
    expect(logged[0]!.request_id).toBe(requestId);
    expect(logged[0]!.code).toBe('server.internal');
    expect(logged[0]!.status).toBe(500);

    // Verify all fields match LOG_EVENT schema
    for (const field of LOG_EVENT.fields) {
      expect(Object.hasOwn(logged[0]!, field)).toBe(true);
    }

    expect(reported).toHaveLength(1);
    expect(reported[0]!.trace_id).toBe(traceId);
    expect(reported[0]!.request_id).toBe(requestId);
    expect(reported[0]!.code).toBe('server.internal');
    expect(reported[0]!.status).toBe(500);

    setErrorReporter(null);
  });

  it('carries trace_id when no response arrived (transport/network failure)', () => {
    const traceId = '5cf92f3577b34da6a3ce929d0e0e4737';
    const logged: Record<string, unknown>[] = [];
    const reported: ReportEvent[] = [];

    setErrorReporter((event) => {
      reported.push(event);
    });

    const mockLogger = {
      debug: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      info: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      warn: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
      error: (_msg: string, fields: Record<string, unknown>) => {
        logged.push(fields);
      },
    };

    const networkError = new DOMException('fetch failed', 'NetworkError');
    const error = classifyError(networkError, traceId);
    expect(error.traceId).toBe(traceId);
    expect(error.code).toBe('network.offline');

    logFailure(error, mockLogger);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.trace_id).toBe(traceId);
    expect(logged[0]!.code).toBe('network.offline');
    expect(logged[0]!.status).toBeNull();

    // If unexpected error, reported as well
    const unexpectedError = new TypeError('null pointer');
    const error2 = classifyError(unexpectedError, traceId);
    logFailure(error2, mockLogger);

    expect(reported).toHaveLength(1);
    expect(reported[0]!.trace_id).toBe(traceId);
    expect(reported[0]!.code).toBe('client.unexpected');

    setErrorReporter(null);
  });
});
