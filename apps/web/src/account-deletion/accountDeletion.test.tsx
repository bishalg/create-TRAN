// Verifies: REQ-ACC-007 — the public page is static, localized from the dictionaries and served
// by the dev server and the build alike.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, within } from '@testing-library/react';
import { TRAN_LOCALES, t } from '@tran/core';
import type { IndexHtmlTransformContext } from 'vite';
import { describe, expect, it } from 'vitest';
import { AccountDeletionPage, sectionId } from './AccountDeletionPage.js';
import { ACCOUNT_DELETION_PAGE, accountDeletionPlugin } from './accountDeletionPlugin.js';
import { PAGE_SLOT, renderAccountDeletionHtml } from './render.js';

const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../..', ACCOUNT_DELETION_PAGE),
  'utf8'
);

describe('the account-deletion page', () => {
  it('says, in every app language, how to delete, what is deleted and what is kept', () => {
    render(<AccountDeletionPage />);
    for (const locale of TRAN_LOCALES) {
      const section = screen.getByRole('region', { name: t('auth.deletionPage.title', locale) });
      expect(section).toHaveAttribute('lang', locale);
      expect(section).toHaveAttribute('id', sectionId(locale));
      const text = section.textContent!;
      for (const key of [
        'auth.deletionPage.intro',
        'auth.deletionPage.howTitle',
        'auth.deletionPage.stepOpen',
        'auth.deletionPage.stepConfirm',
        'auth.deletionPage.deletedBody',
        'auth.deletionPage.keptTitle',
        'auth.deletionPage.keptBody',
      ] as const)
        expect(text).toContain(t(key, locale));
      // The steps name the controls exactly as the app labels them.
      expect(text).toContain(t('common.deleteAccount', locale));
      expect(text).toContain(t('common.signOut', locale));
      expect(
        within(section).getByRole('link', { name: t('auth.deletionPage.openApp', locale) })
      ).toHaveAttribute('href', '/');
    }
  });

  it('links each language to its section, without a script', () => {
    render(<AccountDeletionPage />);
    const languages = screen.getByRole('navigation', { name: t('shell.language.label', 'en') });
    expect(
      within(languages)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual(TRAN_LOCALES.map((locale) => [locale.toUpperCase(), `#${sectionId(locale)}`]));
  });
});

describe('rendering the static page', () => {
  it('fills the template’s title, description and body, and adds no script', () => {
    const html = renderAccountDeletionHtml(template);
    expect(html).toContain('<title>Deleting your TRAN Voting account · TRAN</title>');
    expect(html).toContain(
      `<meta name="description" content="${t('auth.deletionPage.intro', 'en')}" />`
    );
    expect(html).not.toContain(PAGE_SLOT);
    expect(html).toContain(t('auth.deletionPage.keptBody', 'ne'));
    expect(html).not.toMatch(/<script/i);
  });

  it('refuses a template without the slot rather than serve an empty page', () => {
    expect(() => renderAccountDeletionHtml('<html></html>')).toThrow(/has no/);
  });
});

describe('the Vite plugin', () => {
  const transform = (html: string, path: string) => {
    const hook = accountDeletionPlugin().transformIndexHtml as {
      order: string;
      handler: (html: string, ctx: IndexHtmlTransformContext) => string;
    };
    expect(hook.order).toBe('pre');
    return hook.handler(html, { path, filename: path } as IndexHtmlTransformContext);
  };

  it('renders the account-deletion page and leaves every other page alone', () => {
    expect(transform(template, `/${ACCOUNT_DELETION_PAGE}`)).toContain(
      t('auth.deletionPage.title', 'hi')
    );
    expect(transform(template, '/index.html')).toBe(template);
  });
});
