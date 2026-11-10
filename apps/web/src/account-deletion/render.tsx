/**
 * Build-time code (REQ-ACC-007): it runs in Vite under Node and turns the page template into the
 * static page. The browser never loads it, so the page carries no script for the CSP to allow.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '@tran/core';
import { AccountDeletionPage } from './AccountDeletionPage.js';

/** Where the template takes the page's body. */
export const PAGE_SLOT = '<!--account-deletion-->';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The template with its title, description and body filled from the dictionaries. */
export function renderAccountDeletionHtml(template: string): string {
  if (!template.includes(PAGE_SLOT)) throw new Error(`the page template has no ${PAGE_SLOT}`);
  const title = escapeHtml(`${t('auth.deletionPage.title', 'en')} · ${t('common.brand', 'en')}`);
  const description = escapeHtml(t('auth.deletionPage.intro', 'en'));
  return template
    .replace('<title></title>', `<title>${title}</title>`)
    .replace(
      '<meta name="description" content="" />',
      `<meta name="description" content="${description}" />`
    )
    .replace(PAGE_SLOT, renderToStaticMarkup(<AccountDeletionPage />));
}
