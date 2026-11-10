// Verifies: REQ-VER-001 (web and TypeScript clients)
/**
 * No client spells a route's version by hand (REQ-VER-001): every path is built on the generated
 * base path (`API_BASE_PATH`, `apiPath`) or the health path (`HEALTH_PATH`). A regex guard over
 * the shipped sources; comments may name routes, code may not. The native apps add their source
 * folders here once their clients use `ApiContract` (Swift and Kotlin).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCE_DIRS = ['apps/web/src', 'packages/core-ts/src', 'packages/api/src'];

/** A quoted `/api…` path in code: `'/api/v1/x'`, `"/api/health"`, a template literal. */
const ROUTE_LITERAL = /['"`]\/api(\/|['"`])/;
const COMMENT = /^\s*(\*|\/\/|\/\*)/;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function spelledRoutes(file: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      !COMMENT.test(line) && ROUTE_LITERAL.test(line) ? [`${file}:${index + 1}`] : []
    );
}

describe('clients build every path on the generated base path (REQ-VER-001)', () => {
  it('finds a hand-spelled route and ignores one named in a comment', () => {
    const sample = [
      "fetch('/api/v1/vote/eligibility');",
      ' * `POST /api/v1/auth/refresh` restores the session',
      'const url = `${base}/api/health`;',
      "request(apiPath('/tran/info'));",
    ].join('\n');
    expect(spelledRoutes('x.ts', sample)).toEqual(['x.ts:1']);
    expect(spelledRoutes('y.ts', "const p = '/api';")).toEqual(['y.ts:1']);
  });

  it('[REQ-VER-001] no web or TypeScript client source spells an API path', () => {
    const files = SOURCE_DIRS.flatMap(sources);
    expect(files).toContain('packages/api/src/session.ts');
    const spelled = files.flatMap((file) =>
      spelledRoutes(file, readFileSync(join(ROOT, file), 'utf8'))
    );
    expect(spelled, 'use apiPath(…) or HEALTH_PATH from @tran/api').toEqual([]);
  });
});
