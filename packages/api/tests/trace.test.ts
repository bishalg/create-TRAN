// Verifies: REQ-OBS-001
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  childSpan,
  formatTraceparent,
  isLowercaseHex,
  isValidSpanId,
  isValidTraceId,
  newTrace,
  parseTraceparent,
  type TraceContext,
} from '../src/trace.js';

interface TraceFixtures {
  parseValid: {
    name: string;
    header: string;
    expected: TraceContext;
  }[];
  parseInvalid: {
    name: string;
    header: string;
  }[];
  formatCases: {
    context: TraceContext;
    expectedHeader: string;
  }[];
  newTraceCases: {
    name: string;
    randomBytes: number[];
    sampled: boolean;
    expected: TraceContext | null;
    expectedHeader: string | null;
  }[];
  childSpanCases: {
    name: string;
    parentTraceId: string;
    randomBytes: number[];
    sampled: boolean;
    expected: TraceContext | null;
    expectedHeader: string | null;
  }[];
}

const fixtures: TraceFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/trace.json', import.meta.url), 'utf8')
);

describe('REQ-OBS-001: trace context', () => {
  it('parses valid traceparent headers matching fixtures', () => {
    for (const testCase of fixtures.parseValid) {
      const parsed = parseTraceparent(testCase.header);
      expect(parsed, `failed to parse ${testCase.name}`).not.toBeNull();
      expect(parsed).toEqual(testCase.expected);
    }
  });

  it('rejects invalid traceparent headers matching fixtures', () => {
    for (const testCase of fixtures.parseInvalid) {
      const parsed = parseTraceparent(testCase.header);
      expect(parsed, `should reject ${testCase.name}: ${testCase.header}`).toBeNull();
    }
    // Also test null and undefined
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
  });

  it('formats traceparent headers matching fixtures', () => {
    for (const testCase of fixtures.formatCases) {
      const formatted = formatTraceparent(testCase.context);
      expect(formatted).toBe(testCase.expectedHeader);
    }
  });

  it('generates new trace from random bytes matching fixtures', () => {
    for (const testCase of fixtures.newTraceCases) {
      const result = newTrace(testCase.randomBytes, testCase.sampled);
      if (testCase.expected === null) {
        expect(result, `should return null for ${testCase.name}`).toBeNull();
      } else {
        expect(result, `failed for ${testCase.name}`).toEqual(testCase.expected);
        expect(formatTraceparent(result!)).toBe(testCase.expectedHeader);
      }
    }
  });

  it('derives child span from parent trace matching fixtures', () => {
    for (const testCase of fixtures.childSpanCases) {
      const result = childSpan(testCase.parentTraceId, testCase.randomBytes, testCase.sampled);
      if (testCase.expected === null) {
        expect(result, `should return null for ${testCase.name}`).toBeNull();
      } else {
        expect(result, `failed for ${testCase.name}`).toEqual(testCase.expected);
        expect(formatTraceparent(result!)).toBe(testCase.expectedHeader);
      }
    }
  });

  it('validates helper functions', () => {
    expect(isLowercaseHex('0123456789abcdef')).toBe(true);
    expect(isLowercaseHex('0123456789ABCDEF')).toBe(false);
    expect(isValidTraceId('4bf92f3577b34da6a3ce929d0e0e4736')).toBe(true);
    expect(isValidTraceId('00000000000000000000000000000000')).toBe(false);
    expect(isValidSpanId('00f067aa0ba902b7')).toBe(true);
    expect(isValidSpanId('0000000000000000')).toBe(false);
    expect(bytesToHex([0, 15, 16, 255])).toBe('000f10ff');
  });
});
