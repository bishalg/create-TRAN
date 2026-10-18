import { describe, expect, it } from 'vitest';
import { parseAgeInput } from '../src/voting.js';

describe('parseAgeInput (form text -> age or null)', () => {
  it.each([
    ['0', 0],
    ['18', 18],
    [' 21 ', 21],
    ['150', 150],
    ['007', 7],
  ])('accepts %j as %d', (raw, expected) => {
    expect(parseAgeInput(raw)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '21abc', '-1', '151', '21.5', '1e2', '0x10', 'NaN', 'Infinity'])(
    'rejects %j',
    (raw) => {
      expect(parseAgeInput(raw)).toBeNull();
    }
  );
});
