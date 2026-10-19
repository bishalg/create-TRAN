import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

Given('I open the voting eligibility app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
  // Wait for the startup health check so later steps are deterministic.
  await expect(page.getByText(/API (online|offline)/)).toBeVisible();
});

Given('the API is unreachable', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/**', (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect(page.getByText('API offline')).toBeVisible();
});

Given('I use a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

async function fillAndSubmit(page: import('@playwright/test').Page, age: string, country: string) {
  await page.getByLabel('Your age').fill(age);
  await page.getByLabel('Country code').fill(country);
  await page.getByRole('button', { name: 'Check eligibility' }).click();
}

When(
  'I check on this device with age {string} and country {string}',
  async ({ page }, age: string, country: string) => {
    await page.getByRole('radio', { name: /On this device/ }).check();
    await fillAndSubmit(page, age, country);
  }
);

When(
  'I ask the server with age {string} and country {string}',
  async ({ page }, age: string, country: string) => {
    await page.getByRole('radio', { name: /Ask the server/ }).check();
    await fillAndSubmit(page, age, country);
  }
);

// Idempotent: the app starts in the OS-preferred theme, so only click when a change is needed.
When('I switch to the {string} theme', async ({ page }, theme: string) => {
  if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
    const label = theme.charAt(0).toUpperCase() + theme.slice(1);
    await page
      .getByRole('group', { name: 'Theme' })
      .getByRole('button', { name: label, exact: true })
      .click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});

// The inline boot script in index.html must apply the remembered theme before first
// paint: with the app bundle blocked, only the boot script can set <html data-theme>.
When('I reload the page with the app code blocked', async ({ page }) => {
  await page.route('**/src/main.tsx*', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
});

Then('the page reports the {string} colour scheme', async ({ page }, scheme: string) => {
  const colorScheme = await page
    .locator('html')
    .evaluate((element) => getComputedStyle(element).colorScheme);
  expect(colorScheme).toBe(scheme);
});

Then('I am told I am {string}', async ({ page }, verdict: string) => {
  await expect(page.getByRole('heading', { name: verdict, exact: true })).toBeVisible();
});

Then('the result says {string}', async ({ page }, reason: string) => {
  await expect(page.getByText(reason)).toBeVisible();
});

Then('the result shows {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then('an empty {string} live region is already on the page', async ({ page }, name: string) => {
  await expect(page.getByRole('status', { name })).toBeEmpty();
});

Then('the {string} live region says {string}', async ({ page }, name: string, text: string) => {
  await expect(page.getByRole('status', { name })).toContainText(text);
});

When('I switch the language to {string}', async ({ page }, code: string) => {
  await page.getByRole('button', { name: code, exact: true }).click();
});

Then('the document language is {string}', async ({ page }, lang: string) => {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
});

Then('the age field has focus', async ({ page }) => {
  await expect(page.getByLabel('Your age')).toBeFocused();
});

When(
  'I type age {string} and press Enter using only the keyboard',
  async ({ page }, age: string) => {
    await page.getByLabel('Your age').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(age);
    await page.keyboard.press('Enter');
  }
);

Then('I see the error {string}', async ({ page }, message: string) => {
  await expect(page.getByRole('alert')).toContainText(message);
});

Then('I see the offline notice', async ({ page }) => {
  await expect(page.getByRole('note')).toContainText('API unreachable');
});

Then('I do not see the offline notice', async ({ page }) => {
  await expect(page.getByRole('note')).toHaveCount(0);
});

Then('the API status is {string}', async ({ page }, status: string) => {
  await expect(page.getByRole('status').filter({ hasText: status })).toBeVisible();
});

Then('the page uses the {string} theme', async ({ page }, theme: string) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});

Then('the page has no detectable accessibility violations', async ({ page }) => {
  // Axe reads computed colours: let the result card's fade-in finish or it samples mid-opacity.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
});

Then('the page does not scroll horizontally', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
});
