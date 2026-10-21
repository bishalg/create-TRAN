// Verifies: REQ-PERF-002
/**
 * Every registry theme × every locale, plus the states a user passes through. The matrix comes
 * from `@tran/core`, so a new theme or language is captured without editing this file.
 */
import { TRAN_LOCALES, themeNames } from '@tran/core';
import { expect, test, type Page } from '@playwright/test';

/** The production build, in `theme`, with the startup health check settled. */
async function open(page: Page, theme: string) {
  await page.addInitScript((mode) => localStorage.setItem('tran.theme', mode), theme);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByText(/API (online|offline)/)).toBeVisible();
}

for (const theme of themeNames) {
  for (const locale of TRAN_LOCALES) {
    test(`home · ${theme} · ${locale}`, async ({ page }) => {
      await open(page, theme);
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page).toHaveScreenshot(`home-${theme}-${locale}.png`, { fullPage: true });
    });
  }

  test(`result · ${theme}`, async ({ page }) => {
    await open(page, theme);
    await page.getByRole('radio', { name: /On this device/ }).check();
    await page.getByLabel('Your age').fill('20');
    await page.getByLabel('Country code').fill('NP');
    await page.getByRole('button', { name: 'Check eligibility' }).click();
    await expect(page.getByText('Age 20 meets the minimum voting age of 18 in NP.')).toBeVisible();
    await expect(page).toHaveScreenshot(`result-${theme}.png`, { fullPage: true });
  });

  test(`sign-out dialog · ${theme}`, async ({ page }) => {
    await open(page, theme);
    await page.getByTestId('sign-out-button').click();
    await expect(page.getByRole('dialog', { name: 'Sign out?' })).toBeVisible();
    await expect(page).toHaveScreenshot(`sign-out-dialog-${theme}.png`);
  });

  test(`phone · ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, theme);
    await expect(page).toHaveScreenshot(`phone-${theme}.png`, { fullPage: true });
  });
}
