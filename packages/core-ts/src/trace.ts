/**
 * W3C Trace Context (spec 023, REQ-OBS-001). The one implementation lives in `@tran/api`, which
 * every request goes through (`@tran/core` depends on it, not the other way round); it is pinned by
 * `fixtures/trace.json` in `tests/trace.test.ts` through this re-export.
 */
export {
  bytesToHex,
  childSpan,
  formatTraceparent,
  isLowercaseHex,
  isValidSpanId,
  isValidTraceId,
  newTrace,
  nextSpan,
  parseTraceparent,
  requestSpan,
  secureRandomBytes,
  startTrace,
  traceparentOf,
  withTraceparent,
  type RandomBytes,
  type TraceContext,
} from '@tran/api';
