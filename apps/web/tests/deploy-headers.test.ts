// Verifies: REQ-DEP-009 REQ-SEC-024
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/csp/cspPlugin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HEADERS_FILE = join(ROOT, 'deploy/web/_headers');
const CONF_FILE = join(ROOT, 'deploy/web/headers.conf');
const INDEX_HTML = join(ROOT, 'apps/web/index.html');

describe('web deploy headers and cache rules (REQ-DEP-009)', () => {
  it('header files exist in deploy/web/', () => {
    expect(existsSync(HEADERS_FILE)).toBe(true);
    expect(existsSync(CONF_FILE)).toBe(true);
  });

  it('caches hashed assets immutably', () => {
    const text = readFileSync(HEADERS_FILE, 'utf8');
    expect(text).toContain('/assets/*');
    expect(text).toMatch(/Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/);
  });

  it('revalidates index.html and account-deletion.html on every load', () => {
    const text = readFileSync(HEADERS_FILE, 'utf8');
    expect(text).toContain('/index.html');
    expect(text).toContain('/account-deletion.html');
    const matches = [...text.matchAll(/Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('sets required response security headers that cannot be set in <meta>', () => {
    const text = readFileSync(HEADERS_FILE, 'utf8');
    expect(text).toContain("frame-ancestors 'none'");
    expect(text).toMatch(
      /Strict-Transport-Security:\s*max-age=63072000;\s*includeSubDomains;\s*preload/
    );
    expect(text).toContain('X-Content-Type-Options: nosniff');
    expect(text).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(text).toMatch(
      /Permissions-Policy:\s*camera=\(\),\s*microphone=\(\),\s*geolocation=\(\)/
    );
  });

  it('header CSP is at least as strong as the build policy (REQ-SEC-024)', () => {
    const headerText = readFileSync(HEADERS_FILE, 'utf8');
    const indexHtml = readFileSync(INDEX_HTML, 'utf8');
    const buildCsp = contentSecurityPolicy(indexHtml, { apiUrl: 'http://localhost:3001' });

    // The header CSP must include frame-ancestors 'none' which <meta> cannot set
    expect(headerText).toContain("frame-ancestors 'none'");

    // Must never allow unsafe-inline or unsafe-eval in header policy
    expect(headerText).not.toContain("'unsafe-inline'");
    expect(headerText).not.toContain("'unsafe-eval'");

    // Must deny object-src
    expect(headerText).toContain("object-src 'none'");
    expect(buildCsp).toContain("object-src 'none'");

    // Must restrict base-uri and form-action
    expect(headerText).toContain("base-uri 'self'");
    expect(headerText).toContain("form-action 'self'");
  });
});
