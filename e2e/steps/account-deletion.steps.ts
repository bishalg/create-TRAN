// Verifies: REQ-ACC-006 REQ-ACC-007 (web part)
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { ScreenIds, t, TRAN_LOCALES } from '@tran/core';

const { Given, When, Then } = createBdd();

const PAGE = '/account-deletion.html';

// A fresh browser: no session cookie, no app installed, nothing signed in.
Given('I open the account deletion page', async ({ page }) => {
  const response = await page.goto(PAGE);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

Then(
  'it explains how to delete, what is deleted and what is kept in every app language',
  async ({ page }) => {
    for (const locale of TRAN_LOCALES) {
      const section = page.getByRole('region', { name: t('auth.deletionPage.title', locale) });
      await expect(section).toHaveAttribute('lang', locale);
      await expect(section).toContainText(t('auth.deletionPage.howTitle', locale));
      await expect(section).toContainText(t('common.deleteAccount', locale));
      await expect(section).toContainText(t('auth.deletionPage.deletedBody', locale));
      await expect(section).toContainText(t('auth.deletionPage.keptTitle', locale));
      await expect(section).toContainText(t('auth.deletionPage.keptBody', locale));
    }
  }
);

When('I follow the link to the web app', async ({ page }) => {
  await page.getByRole('link', { name: t('auth.deletionPage.openApp', 'en') }).click();
});

Then('I see role selection', async ({ page }) => {
  await expect(page.getByTestId(ScreenIds.authWelcome.voterBranchButton)).toBeVisible();
  await expect(page.getByTestId(ScreenIds.eligibility.deleteAccountButton)).toHaveCount(0);
});

// The API session is established behind the device sign-in; wait for it, so the deletion
// carries a token the real server accepts. The demo accounts are shared per role and a deletion
// signs out every session of it (REQ-ACC-002), so this deletes the auditor: the voter scenarios
// running in parallel hold voter sessions the API must keep accepting.
Given('I am signed in to the API as an election auditor', async ({ page }) => {
  await page.goto('/');
  const signedIn = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/auth/session') && r.request().method() === 'POST'
  );
  await page.getByTestId(ScreenIds.authWelcome.auditorBranchButton).click();
  expect((await signedIn).status()).toBe(201);
});

When('I delete my account and confirm', async ({ page }) => {
  await page.getByTestId(ScreenIds.auditor.deleteAccountButton).click();
  const deleted = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/account') && r.request().method() === 'DELETE'
  );
  await page.getByTestId(ScreenIds.auditor.deleteAccountConfirm).click();
  expect((await deleted).status()).toBe(204);
});

Then('I am told my account was deleted', async ({ page }) => {
  await expect(page.getByRole('region', { name: t('common.notifications', 'en') })).toContainText(
    t('auth.accountDeleted', 'en')
  );
});

// The server revoked every session (REQ-ACC-002), and the sign-out that follows the deletion
// removed the refresh cookie from the browser: nothing is left to restore.
Then('after a reload I still see role selection', async ({ page }) => {
  await expect
    .poll(async () => (await page.context().cookies()).map((cookie) => cookie.name))
    .not.toContain('tran_refresh');
  const refresh = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'));
  await page.reload();
  expect((await refresh).status()).toBe(401);
  await expect(page.getByTestId(ScreenIds.authWelcome.voterBranchButton)).toBeVisible();
});
