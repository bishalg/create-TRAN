// Verifies: REQ-WEB-010, REQ-WEB-011
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/styles/app.css'),
  'utf8'
);

describe('app.css token guard', () => {
  it('does not use raw px/rem outside custom-property definitions', () => {
    const rawSize = /[0-9.]+(px|rem)\b/g;
    const offenders: string[] = [];

    for (const line of appCss.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('/*')) continue;
      if (trimmed.includes('--') && trimmed.includes(':')) continue;
      const matches = line.match(rawSize);
      if (matches) offenders.push(trimmed);
    }

    expect(offenders).toEqual([]);
  });
});
