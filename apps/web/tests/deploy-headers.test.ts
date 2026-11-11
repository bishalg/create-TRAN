// Verifies: REQ-DEP-009, REQ-SEC-024
/**
 * The web host's header files (deploy/web/_headers for Netlify / Cloudflare Pages, headers.conf for
 * nginx), parsed: they agree with each other path by path, and their Content-Security-Policy can
 * neither weaken nor break the policy the build puts in each page's <meta> (cspPlugin.ts). Browsers
 * enforce both policies, so a header directive the meta policy also has must say exactly the same,
 * and the header must not add a fetch directive (script-src, connect-src, default-src …) that would
 * block the hashed inline script or the API origin.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/csp/cspPlugin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

type Headers = Record<string, string>;

/** `_headers`: rules of a path pattern and its indented `Name: value` lines. */
function parseHeadersFile(text: string): { pattern: string; headers: Headers }[] {
  const rules: { pattern: string; headers: Headers }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
    else {
      const [, name, value] = /^\s+([\w-]+):\s*(.+)$/.exec(line) ?? [];
      const rule = rules.at(-1);
      if (!rule || !name) throw new Error(`_headers: cannot read "${line}"`);
      expect(rule.headers[name], `${name} twice in ${rule.pattern}`).toBeUndefined();
      rule.headers[name] = value!.trim();
    }
  }
  return rules;
}

/** The headers `_headers` gives `path`; a header set by two matching rules fails (hosts merge them). */
function headersFor(rules: ReturnType<typeof parseHeadersFile>, path: string): Headers {
  const merged: Headers = {};
  for (const { pattern, headers } of rules) {
    const matches = pattern.endsWith('*')
      ? path.startsWith(pattern.slice(0, -1))
      : path === pattern;
    if (!matches) continue;
    for (const [name, value] of Object.entries(headers)) {
      expect(merged[name], `${path}: ${name} from two rules`).toBeUndefined();
      merged[name] = value;
    }
  }
  return merged;
}

/** headers.conf: `location <prefix> { add_header … always; }` blocks. */
function parseNginx(text: string): { prefix: string; headers: Headers; lines: string[] }[] {
  return [...text.matchAll(/^location\s+(\S+)\s*\{([\s\S]*?)^\}/gm)].map(([, prefix, body]) => {
    const lines = body!.split('\n').filter((l) => l.includes('add_header'));
    const headers: Headers = {};
    for (const line of lines) {
      const [, name, value] = /add_header\s+([\w-]+)\s+"([^"]*)"/.exec(line) ?? [];
      headers[name!] = value!;
    }
    return { prefix: prefix!, headers, lines };
  });
}

/** nginx picks the longest matching prefix location. */
function nginxFor(blocks: ReturnType<typeof parseNginx>, path: string): Headers {
  const block = blocks
    .filter((b) => path.startsWith(b.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return block?.headers ?? {};
}

/** A policy as directive → value. */
function parsePolicy(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name!, values.join(' ')])
  );
}

/** Directives the header may carry: what <meta> cannot express, and ones that never block the app's code. */
const HEADER_ONLY = ['frame-ancestors'];
const SHARED = ['object-src', 'base-uri', 'form-action'];

/** Why a header policy would weaken or break a page's meta policy; empty when it cannot. */
function headerPolicyProblems(header: string, meta: string): string[] {
  const problems: string[] = [];
  const h = parsePolicy(header);
  const m = parsePolicy(meta);
  if (h.get('frame-ancestors') !== "'none'") problems.push("frame-ancestors must be 'none'");
  for (const [name, value] of h) {
    if (HEADER_ONLY.includes(name)) continue;
    if (!SHARED.includes(name)) problems.push(`${name} in the header could block the page`);
    else if (m.get(name) !== value)
      problems.push(`${name} differs: header ${value}, page ${m.get(name)}`);
  }
  for (const name of SHARED) if (!h.has(name)) problems.push(`${name} missing from the header`);
  return problems;
}

const rules = parseHeadersFile(read('deploy/web/_headers'));
const nginxText = read('deploy/web/headers.conf');
const nginx = parseNginx(nginxText);
const PAGES = ['/', '/index.html', '/account-deletion.html', '/vote/some/deep/link'];
const ASSET = '/assets/index-Ab12Cd34.js';
const SECURITY = [
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Strict-Transport-Security',
  'Permissions-Policy',
  'Content-Security-Policy',
];
/** The meta policy of each built page, for two different API origins. */
const metaPolicies = ['http://127.0.0.1:3001', 'https://api.example.com'].flatMap((apiUrl) =>
  ['apps/web/index.html', 'apps/web/account-deletion.html'].map((page) =>
    contentSecurityPolicy(read(page), { apiUrl })
  )
);

describe('web deploy headers and cache rules (REQ-DEP-009)', () => {
  it('REQ-DEP-009 every path, deep links included, gets the security headers, the same in both files', () => {
    for (const path of [...PAGES, ASSET]) {
      const host = headersFor(rules, path);
      const conf = nginxFor(nginx, path);
      for (const name of SECURITY) {
        expect(host[name], `${path} ${name}`).toBeTruthy();
        expect(conf[name], `${path} ${name} in headers.conf`).toBe(host[name]);
      }
    }
    const strict = headersFor(rules, '/');
    expect(strict['X-Content-Type-Options']).toBe('nosniff');
    expect(strict['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(strict['Permissions-Policy']).toMatch(/camera=\(\), microphone=\(\), geolocation=\(\)/);
  });

  it('REQ-DEP-009 hashed assets are immutable; HTML entry points and deep links revalidate', () => {
    const immutable = 'public, max-age=31536000, immutable';
    const revalidate = 'public, max-age=0, must-revalidate';
    expect(headersFor(rules, ASSET)['Cache-Control']).toBe(immutable);
    expect(nginxFor(nginx, ASSET)['Cache-Control']).toBe(immutable);
    for (const path of ['/', '/index.html', '/account-deletion.html'])
      expect(headersFor(rules, path)['Cache-Control'], path).toBe(revalidate);
    // A deep link: the hosts' default on `_headers` hosts (revalidate), explicit on nginx.
    expect(headersFor(rules, PAGES[3]!)['Cache-Control']).toBeUndefined();
    for (const path of PAGES) expect(nginxFor(nginx, path)['Cache-Control'], path).toBe(revalidate);
  });

  it('REQ-DEP-009 nginx sends every header on errors too, and says it is nginx', () => {
    for (const block of nginx)
      for (const line of block.lines) expect(line.trim(), block.prefix).toMatch(/ always;$/);
    expect(nginxText).not.toMatch(/caddy/i);
    expect(nginxText).toMatch(/try_files \$uri \$uri\/ \/index\.html;/);
  });
});

describe('the header policy agrees with the page policy (REQ-SEC-024)', () => {
  const header = headersFor(rules, '/')['Content-Security-Policy']!;

  it('REQ-SEC-024 the header CSP can neither weaken nor break any built page, whatever the API', () => {
    for (const meta of metaPolicies) expect(headerPolicyProblems(header, meta), meta).toEqual([]);
  });

  it('REQ-SEC-024 a header that would block the app, or weaken the page, is caught', () => {
    const meta = metaPolicies[0]!;
    expect(headerPolicyProblems(`${header}; script-src 'self'`, meta)).toEqual([
      'script-src in the header could block the page',
    ]);
    expect(headerPolicyProblems(`${header}; connect-src 'self'`, meta)).toEqual([
      'connect-src in the header could block the page',
    ]);
    expect(headerPolicyProblems(`default-src 'self'; ${header}`, meta)).toEqual([
      'default-src in the header could block the page',
    ]);
    expect(headerPolicyProblems("object-src *; frame-ancestors 'none'", meta)).toEqual([
      "object-src differs: header *, page 'none'",
      'base-uri missing from the header',
      'form-action missing from the header',
    ]);
    expect(
      headerPolicyProblems("object-src 'none'; base-uri 'self'; form-action 'self'", meta)
    ).toEqual(["frame-ancestors must be 'none'"]);
  });

  it('REQ-SEC-024 the page policy still has what the header relies on it for', () => {
    const meta = parsePolicy(metaPolicies[0]!);
    expect(meta.get('script-src')).toMatch(/^'self'( 'sha256-[A-Za-z0-9+/=]+')+$/);
    expect(meta.get('connect-src')).toBe("'self' http://127.0.0.1:3001");
    expect(meta.get('default-src')).toBe("'self'");
  });
});
