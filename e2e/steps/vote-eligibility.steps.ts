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
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});

Then('I am told I am {string}', async ({ page }, verdict: string) => {
  await expect(page.getByRole('heading', { name: verdict, exact: true })).toBeVisible();
});

Then('the result says {string}', async ({ page }, reason: string) => {
  await expect(page.getByText(reason)).toBeVisible();
});

Then('the result was checked {string}', async ({ page }, where: string) => {
  await expect(page.getByText(where, { exact: true })).toBeVisible();
});

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
