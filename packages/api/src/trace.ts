/**
 * Minimal W3C Trace Context helpers for @tran/api client requests (spec 023, REQ-OBS-010).
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT_LEN = 55;
const TRACE_ID_LEN = 32;
const SPAN_ID_LEN = 16;
const VERSION_00 = '00';
const HEX_PATTERN = /^[0-9a-f]+$/;

function generateRandomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export function newTraceContext(sampled = true): TraceContext {
  return {
    traceId: generateRandomHex(16),
    spanId: generateRandomHex(8),
    sampled,
  };
}

export function childSpanContext(traceId: string, sampled = true): TraceContext {
  return {
    traceId,
    spanId: generateRandomHex(8),
    sampled,
  };
}

export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

export function parseTraceparent(header?: string | null): TraceContext | null {
  if (!header || header.length !== TRACEPARENT_LEN) return null;
  const parts = header.split('-');
  if (parts.length !== 4 || parts[0] !== VERSION_00) return null;
  const traceId = parts[1]!;
  const spanId = parts[2]!;
  const flagsStr = parts[3]!;
  if (traceId.length !== TRACE_ID_LEN || spanId.length !== SPAN_ID_LEN) return null;
  if (!HEX_PATTERN.test(traceId) || !HEX_PATTERN.test(spanId) || !HEX_PATTERN.test(flagsStr)) {
    return null;
  }
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  const flags = parseInt(flagsStr, 16);
  return { traceId, spanId, sampled: (flags & 0x01) !== 0 };
}
