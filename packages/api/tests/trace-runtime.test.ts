// Verifies: REQ-OBS-001 REQ-OBS-010
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import {
  nextSpan,
  requestSpan,
  secureRandomBytes,
  startTrace,
  traceparentOf,
  withTraceparent,
  type RandomBytes,
} from '../src/index.js';

/** A deterministic source: byte `i` of the whole stream is `(seed + i) % 256`. */
function counting(seed = 1): RandomBytes {
  let next = seed;
  return (count) => Uint8Array.from({ length: count }, () => next++ % 256 || 7);
}

const zeros: RandomBytes = (count) => new Uint8Array(count);

describe('REQ-OBS-001: one trace implementation, randomness injected', () => {
  it('starts a trace from the injected source', () => {
    expect(startTrace(counting(1))).toEqual({
      traceId: '0102030405060708090a0b0c0d0e0f10',
      spanId: '1112131415161718',
      sampled: true,
    });
    expect(startTrace(counting(1), false).sampled).toBe(false);
  });

  it('draws again when the source returns an all-zero id, and gives up on a broken source', () => {
    let calls = 0;
    const firstZero: RandomBytes = (count) => (calls++ === 0 ? zeros(count) : counting(1)(count));
    expect(startTrace(firstZero).traceId).toBe('0102030405060708090a0b0c0d0e0f10');
    expect(() => startTrace(zeros)).toThrow(/random source/);
    expect(() => nextSpan('4bf92f3577b34da6a3ce929d0e0e4736', zeros)).toThrow(/random source/);
  });

  it('a span keeps the trace id and draws a new span id', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const random = counting(1);
    const a = nextSpan(traceId, random);
    const b = nextSpan(traceId, random, false);
    expect(a.traceId).toBe(traceId);
    expect(b).toMatchObject({ traceId, sampled: false });
    expect(a.spanId).not.toBe(b.spanId);
  });

  it('a span of an invalid trace id starts a new trace instead', () => {
    const span = nextSpan('not-a-trace', counting(1));
    expect(span.traceId).toBe('0102030405060708090a0b0c0d0e0f10');
  });

  it('the default source is the platform CSPRNG', () => {
    expect(secureRandomBytes(8)).toHaveLength(8);
    expect(startTrace().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('exports no second, unpinned trace generator', () => {
    expect(Object.keys(api)).not.toContain('newTraceContext');
    expect(Object.keys(api)).not.toContain('childSpanContext');
    const source = readFileSync(new URL('../src/trace.ts', import.meta.url), 'utf8');
    // The CSPRNG is read in one place only: the injected default.
    expect(source.match(/getRandomValues/g)).toHaveLength(1);
  });
});

describe('REQ-OBS-010: the traceparent header is set once, whatever its case', () => {
  it('reads the header in any case', () => {
    expect(traceparentOf(undefined)).toBeUndefined();
    expect(traceparentOf({ Traceparent: 'a' })).toBe('a');
    expect(traceparentOf({ TRACEPARENT: 'b' })).toBe('b');
    expect(traceparentOf({ accept: 'x' })).toBeUndefined();
  });

  it('a request span continues the action, else the caller header, else starts a trace', () => {
    const action = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const header = { Traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00' };
    expect(requestSpan(action, header, counting(1))).toMatchObject({
      traceId: action,
      sampled: false,
    });
    expect(requestSpan(undefined, header, counting(1))).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '0102030405060708',
    });
    expect(requestSpan(undefined, { traceparent: 'junk' }, counting(1))).toMatchObject({
      traceId: '0102030405060708090a0b0c0d0e0f10',
      sampled: true,
    });
  });

  it('replaces a caller header of any case with one lowercase header', () => {
    const headers = withTraceparent({ Traceparent: 'old', Accept: 'json' }, 'new');
    expect(headers).toEqual({ Accept: 'json', traceparent: 'new' });
    expect(withTraceparent(undefined, 'v')).toEqual({ traceparent: 'v' });
  });
});
