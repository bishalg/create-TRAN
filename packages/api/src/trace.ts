// Verifies: REQ-OBS-001 REQ-OBS-010
/**
 * W3C Trace Context for every TypeScript client (spec 023): the one implementation, mirroring
 * `crates/rust-core/src/trace.rs` and pinned by `fixtures/trace.json` (REQ-OBS-001). The pure
 * functions take their random bytes; `startTrace` and `nextSpan` take the source, defaulting to the
 * platform CSPRNG, so tests inject one. `@tran/core` re-exports this module.
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/** `count` random bytes. */
export type RandomBytes = (count: number) => Uint8Array;

const TRACEPARENT_LEN = 55;
const TRACE_ID_LEN = 32;
const SPAN_ID_LEN = 16;
const FLAGS_LEN = 2;
const VERSION_00 = '00';
const TRACE_BYTES = 16;
const SPAN_BYTES = 8;
/** An all-zero draw has odds of 2^-64; a source that keeps giving one is broken. */
const MAX_DRAWS = 4;

const LOWER_HEX = /^[0-9a-f]+$/;
const ALL_ZERO = /^0+$/;

export function isLowercaseHex(s: string): boolean {
  return LOWER_HEX.test(s);
}

export function isValidTraceId(id: string): boolean {
  return id.length === TRACE_ID_LEN && isLowercaseHex(id) && !ALL_ZERO.test(id);
}

export function isValidSpanId(id: string): boolean {
  return id.length === SPAN_ID_LEN && isLowercaseHex(id) && !ALL_ZERO.test(id);
}

export function bytesToHex(bytes: Uint8Array | readonly number[]): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (!header || header.length !== TRACEPARENT_LEN) return null;
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flagsStr] = parts as [string, string, string, string];
  if (version !== VERSION_00) return null;
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return null;
  if (flagsStr.length !== FLAGS_LEN || !isLowercaseHex(flagsStr)) return null;
  const sampled = (parseInt(flagsStr, 16) & 0x01) !== 0;
  return { traceId, spanId, sampled };
}

export function formatTraceparent(trace: TraceContext): string {
  return `00-${trace.traceId}-${trace.spanId}-${trace.sampled ? '01' : '00'}`;
}

/** A new trace from 24 random bytes (16 trace id, 8 span id); `null` on too few or all-zero bytes. */
export function newTrace(
  randomBytes: Uint8Array | readonly number[],
  sampled = true
): TraceContext | null {
  if (randomBytes.length < TRACE_BYTES + SPAN_BYTES) return null;
  const traceId = bytesToHex(randomBytes.slice(0, TRACE_BYTES));
  const spanId = bytesToHex(randomBytes.slice(TRACE_BYTES, TRACE_BYTES + SPAN_BYTES));
  return isValidTraceId(traceId) && isValidSpanId(spanId) ? { traceId, spanId, sampled } : null;
}

/** The same trace with a span id from 8 random bytes; `null` on a bad parent or all-zero bytes. */
export function childSpan(
  parentTraceId: string,
  randomBytes: Uint8Array | readonly number[],
  sampled = true
): TraceContext | null {
  if (!isValidTraceId(parentTraceId) || randomBytes.length < SPAN_BYTES) return null;
  const spanId = bytesToHex(randomBytes.slice(0, SPAN_BYTES));
  return isValidSpanId(spanId) ? { traceId: parentTraceId, spanId, sampled } : null;
}

/** The platform CSPRNG: the only impure piece, and the default source below. */
export const secureRandomBytes: RandomBytes = (count) =>
  globalThis.crypto.getRandomValues(new Uint8Array(count));

function draw(make: () => TraceContext | null): TraceContext {
  for (let i = 0; i < MAX_DRAWS; i += 1) {
    const trace = make();
    if (trace) return trace;
  }
  throw new Error('The random source returned only zeros');
}

/** A new trace: what one user action starts (REQ-OBS-010). */
export function startTrace(random: RandomBytes = secureRandomBytes, sampled = true): TraceContext {
  return draw(() => newTrace(random(TRACE_BYTES + SPAN_BYTES), sampled));
}

/** A new span of `traceId` for one request of the action; an invalid id starts a new trace. */
export function nextSpan(
  traceId: string,
  random: RandomBytes = secureRandomBytes,
  sampled = true
): TraceContext {
  if (!isValidTraceId(traceId)) return startTrace(random, sampled);
  return draw(() => childSpan(traceId, random(SPAN_BYTES), sampled));
}

const isTraceparentKey = (key: string) => key.toLowerCase() === 'traceparent';

/** The caller's `traceparent`, whatever case its key has. */
export function traceparentOf(headers: Record<string, string> | undefined): string | undefined {
  const key = Object.keys(headers ?? {}).find(isTraceparentKey);
  return key === undefined ? undefined : headers![key];
}

/** `headers` with exactly one, lowercase `traceparent`: two would combine into an invalid value. */
export function withTraceparent(
  headers: Record<string, string> | undefined,
  traceparent: string
): Record<string, string> {
  const rest = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => !isTraceparentKey(key))
  );
  return { ...rest, traceparent };
}

/** The span for one request: a child of the action's trace, else of the caller's header, else new. */
export function requestSpan(
  traceId: string | undefined,
  headers: Record<string, string> | undefined,
  random: RandomBytes = secureRandomBytes
): TraceContext {
  const parent = parseTraceparent(traceparentOf(headers));
  const id = traceId ?? parent?.traceId;
  const sampled = parent?.sampled ?? true;
  return id === undefined ? startTrace(random, sampled) : nextSpan(id, random, sampled);
}
