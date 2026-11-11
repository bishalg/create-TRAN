// Verifies: REQ-OBS-001
/**
 * W3C Trace Context representation and pure propagation operations (spec 023, REQ-OBS-001).
 * Mirrors `crates/rust-core/src/trace.rs`; pinned by `fixtures/trace.json`.
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT_LEN = 55;
const TRACE_ID_LEN = 32;
const SPAN_ID_LEN = 16;
const FLAGS_LEN = 2;
const VERSION_00 = '00';

const LOWER_HEX = /^[0-9a-f]+$/;

export function isLowercaseHex(s: string): boolean {
  return LOWER_HEX.test(s);
}

export function isValidTraceId(id: string): boolean {
  return id.length === TRACE_ID_LEN && isLowercaseHex(id) && !/^0+$/.test(id);
}

export function isValidSpanId(id: string): boolean {
  return id.length === SPAN_ID_LEN && isLowercaseHex(id) && !/^0+$/.test(id);
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
  const [version, traceId, spanId, flagsStr] = parts;
  if (version !== VERSION_00) return null;
  if (!isValidTraceId(traceId!) || !isValidSpanId(spanId!)) return null;
  if (flagsStr!.length !== FLAGS_LEN || !isLowercaseHex(flagsStr!)) return null;

  const flags = parseInt(flagsStr!, 16);
  const sampled = (flags & 0x01) !== 0;

  return { traceId: traceId!, spanId: spanId!, sampled };
}

export function formatTraceparent(trace: TraceContext): string {
  const flags = trace.sampled ? '01' : '00';
  return `00-${trace.traceId}-${trace.spanId}-${flags}`;
}

export function newTrace(
  randomBytes: Uint8Array | readonly number[],
  sampled = true
): TraceContext | null {
  if (randomBytes.length < 24) return null;
  const traceBytes = randomBytes.slice(0, 16);
  const spanBytes = randomBytes.slice(16, 24);
  const isAllZero = (arr: Uint8Array | readonly number[]) => {
    for (let i = 0; i < arr.length; i += 1) if (arr[i] !== 0) return false;
    return true;
  };
  if (isAllZero(traceBytes) || isAllZero(spanBytes)) return null;
  return {
    traceId: bytesToHex(traceBytes),
    spanId: bytesToHex(spanBytes),
    sampled,
  };
}

export function childSpan(
  parentTraceId: string,
  randomBytes: Uint8Array | readonly number[],
  sampled = true
): TraceContext | null {
  if (!isValidTraceId(parentTraceId) || randomBytes.length < 8) return null;
  const spanBytes = randomBytes.slice(0, 8);
  const isAllZero = (arr: Uint8Array | readonly number[]) => {
    for (let i = 0; i < arr.length; i += 1) if (arr[i] !== 0) return false;
    return true;
  };
  if (isAllZero(spanBytes)) return null;
  return {
    traceId: parentTraceId,
    spanId: bytesToHex(spanBytes),
    sampled,
  };
}
