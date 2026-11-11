// Verifies: REQ-OBS-011
import { describe, expect, it } from 'vitest';
import { rememberTrace, sentTraceId } from '../src/transport-trace.js';

describe('the trace a failed request was sent with (REQ-OBS-011)', () => {
  it('is remembered from the request headers, whatever their form', () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const a = rememberTrace(new Error('a'), { traceparent: tp });
    const b = rememberTrace(new Error('b'), new Headers({ Traceparent: tp }));
    expect(sentTraceId(a)).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(sentTraceId(b)).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('is absent when the request carried none, and for anything that is not an object', () => {
    expect(sentTraceId(rememberTrace(new Error('c'), undefined))).toBeUndefined();
    expect(sentTraceId(new Error('never seen'))).toBeUndefined();
    expect(sentTraceId('text')).toBeUndefined();
    expect(sentTraceId(null)).toBeUndefined();
  });
});
