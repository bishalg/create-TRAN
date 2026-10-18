import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

const offlineCard = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: /offline \(rust rules mirror\)/i });
const apiCard = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: /api \(country from ip stub\)/i });

Given('I open the voting eligibility app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
});

Given('the API is unreachable', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/**', (route) => route.abort('connectionrefused'));
  await page.reload();
});

When(
  'I check offline with age {string} and country {string}',
  async ({ page }, age: string, country: string) => {
    const card = offlineCard(page);
    await card.getByLabel('Age (years)').fill(age);
    await card.getByLabel('Country (offline)').fill(country);
    await card.getByRole('button', { name: 'Check offline' }).click();
  }
);

When(
  'I check via the API with age {string} and debug country {string}',
  async ({ page }, age: string, country: string) => {
    const card = apiCard(page);
    await card.getByLabel('Age (years)').fill(age);
    await card.getByLabel('Debug country (API header)').fill(country);
    await card.getByRole('button', { name: 'Check via API' }).click();
  }
);

Then('I am told I am {string}', async ({ page }, verdict: string) => {
  await expect(page.getByText(verdict, { exact: true })).toBeVisible();
});

Then('the result says {string}', async ({ page }, reason: string) => {
  await expect(page.getByText(reason)).toBeVisible();
});

Then('I see the error {string}', async ({ page }, message: string) => {
  await expect(page.getByRole('alert')).toContainText(message);
});

Then('I see the offline notice', async ({ page }) => {
  await expect(page.getByText(/API unreachable/)).toBeVisible();
});

Then('I do not see the offline notice', async ({ page }) => {
  await expect(page.getByText(/API unreachable/)).toHaveCount(0);
});

Then('the system status is {string}', async ({ page }, status: string) => {
  await expect(page.getByText(status)).toBeVisible();
});

Then('the status lists {string} and {string}', async ({ page }, a: string, b: string) => {
  await expect(page.getByText(a)).toBeVisible();
  await expect(page.getByText(b)).toBeVisible();
});
