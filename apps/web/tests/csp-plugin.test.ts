// Verifies: REQ-SEC-024
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor, IndexHtmlTransformHook } from 'vite';
import {
  contentSecurityPolicy,
  cspPlugin,
  hashSource,
  inlineScripts,
} from '../src/csp/cspPlugin.js';

const indexHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../index.html'),
  'utf8'
);
const API = { apiUrl: 'https://api.example.com/v1/' };

/** The hash computed independently, with WebCrypto. */
async function expectedHash(text: string) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${Buffer.from(digest).toString('base64')}'`;
}

describe('the CSP of the production build (REQ-SEC-024)', () => {
  it('finds inline scripts and skips scripts loaded by src', () => {
    const html = [
      '<script>one()</script>',
      '<script type="module" src="/src/main.tsx"></script>',
      '<SCRIPT data-x="1">\ntwo()\n</SCRIPT>',
    ].join('\n');
    expect(inlineScripts(html)).toEqual(['one()', '\ntwo()\n']);
  });

  it('hashes the exact script text with SHA-256', async () => {
    const [theme] = inlineScripts(indexHtml);
    expect(theme).toContain('localStorage');
    expect(hashSource(theme!)).toBe(await expectedHash(theme!));
    expect(hashSource(`${theme} `)).not.toBe(hashSource(theme!));
  });

  it('allows self, the inline scripts by hash and the API origin, and nothing else', async () => {
    const [theme] = inlineScripts(indexHtml);
    expect(contentSecurityPolicy(indexHtml, API)).toBe(
      [
        "default-src 'self'",
        `script-src 'self' ${await expectedHash(theme!)}`,
        "connect-src 'self' https://api.example.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
    expect(contentSecurityPolicy('<p>no scripts</p>', API)).toContain("script-src 'self';");
  });

  it('runs for the build only, last, and puts the meta first in <head>', () => {
    const plugin = cspPlugin(API);
    expect(plugin.apply).toBe('build');
    const hook = plugin.transformIndexHtml as { order: string; handler: IndexHtmlTransformHook };
    expect(hook.order).toBe('post');
    const result = hook.handler.call(undefined as never, indexHtml, {} as never) as {
      html: string;
      tags: HtmlTagDescriptor[];
    };
    expect(result.html).toBe(indexHtml);
    expect(result.tags).toEqual([
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: contentSecurityPolicy(indexHtml, API),
        },
        injectTo: 'head-prepend',
      },
    ]);
  });
});
