// Verifies: REQ-WEB-013
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('eslint config', () => {
  it('forbids inline style and raw semantic tags outside shared/ui', () => {
    const config = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../eslint.config.js'),
      'utf8'
    );
    expect(config).toContain('forbid-dom-props');
    expect(config).toContain("forbid: ['style']");
    expect(config).toContain('shared/ui');
  });
});
