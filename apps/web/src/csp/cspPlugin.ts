/**
 * The Content Security Policy of the production build (REQ-SEC-024, ADR-0039). Build-time code: it
 * runs in Vite under Node, never in the browser.
 *
 * Only the production `index.html` gets it: the dev server's HMR client needs inline scripts and a
 * websocket this policy forbids. `frame-ancestors` cannot be set by `<meta>`; the host's response
 * headers own it (`docs/SECURITY.md`).
 */
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export interface CspOptions {
  /** The API the page calls (`VITE_TRAN_API_URL`); its origin joins `connect-src`. */
  apiUrl: string;
}

/** The text of every inline script; a script with `src` loads from `'self'` instead. */
export function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes!))
    .map(([, , body]) => body!);
}

/** A CSP hash source for `text`. */
export function hashSource(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** The policy for `html`, whose inline scripts are allowed by hash and nothing else. */
export function contentSecurityPolicy(html: string, { apiUrl }: CspOptions): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScripts(html).map(hashSource)].join(' '),
    `connect-src 'self' ${new URL(apiUrl).origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Injects the policy as the first element of `<head>`, so it governs every script after it. */
export function cspPlugin(options: CspOptions): Plugin {
  return {
    name: 'tran-csp',
    apply: 'build',
    transformIndexHtml: {
      // After every other plugin, so the hashes cover the final inline scripts.
      order: 'post',
      handler: (html) => ({
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: contentSecurityPolicy(html, options),
            },
            injectTo: 'head-prepend',
          },
        ],
      }),
    },
  };
}
