/**
 * Serves the public account-deletion page (REQ-ACC-007) from the dev server and the build alike:
 * `account-deletion.html` is a second page of the Vite build, and this plugin fills it with the
 * static markup before any other plugin, so the CSP plugin (`order: 'post'`) sees the final page.
 */
import type { Plugin } from 'vite';
import { renderAccountDeletionHtml } from './render.js';

/** The page's file name, at the web root: `/account-deletion.html`. */
export const ACCOUNT_DELETION_PAGE = 'account-deletion.html';

export function accountDeletionPlugin(): Plugin {
  return {
    name: 'tran-account-deletion',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, { path }) =>
        path.endsWith(`/${ACCOUNT_DELETION_PAGE}`) ? renderAccountDeletionHtml(html) : html,
    },
  };
}
