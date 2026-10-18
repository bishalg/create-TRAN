import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

Given('I launch the application', async ({ page }) => {
  await page.goto('/');
  const signOutBtn = page.getByTestId('sign-out-button');
  if (await signOutBtn.isVisible()) {
    await signOutBtn.click();
  }
  await expect(
    page.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })
  ).toBeVisible();
});

Then(
  'I see the role selection options {string} and {string}',
  async ({ page }, optionA: string, optionB: string) => {
    await expect(page.getByRole('button', { name: optionA })).toBeVisible();
    await expect(page.getByRole('button', { name: optionB })).toBeVisible();
  }
);

When('I select the role {string}', async ({ page }, roleLabel: string) => {
  await page.getByRole('button', { name: new RegExp(`Continue as ${roleLabel}`) }).click();
});

Then('I am routed to the {string} dashboard', async ({ page }, dashboardTitle: string) => {
  await expect(page.getByRole('heading', { name: new RegExp(dashboardTitle) })).toBeVisible();
});

Then('I see the user role badge {string}', async ({ page }, badgeText: string) => {
  await expect(page.getByTestId('role-badge')).toHaveText(badgeText);
});

Then('I see the global voting age rules for countries', async ({ page }) => {
  await expect(page.getByText('NP')).toBeVisible();
  await expect(page.getByText('BR')).toBeVisible();
});

Given(
  'I am on the {string} dashboard as {string}',
  async ({ page }, _dashboard: string, role: string) => {
    await page.goto('/');
    const badge = page.getByTestId('role-badge');
    if (!(await badge.isVisible()) || (await badge.textContent()) !== role) {
      const signOutBtn = page.getByTestId('sign-out-button');
      if (await signOutBtn.isVisible()) {
        await signOutBtn.click();
      }
      await page.getByRole('button', { name: new RegExp(`Continue as ${role}`) }).click();
    }
    await expect(badge).toHaveText(role);
  }
);

When('I click the sign out button', async ({ page }) => {
  await page.getByTestId('sign-out-button').click();
});
