import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { ScreenIds } from '@tran/core';

const { Given, When, Then } = createBdd();

/** Sign-out is destructive, so it always goes through the confirmation dialog (REQ-ERR-007). */
async function signOut(page: import('@playwright/test').Page) {
  await page.getByTestId(ScreenIds.eligibility.signOutButton).click();
  await page
    .getByRole('dialog', { name: 'Sign out?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
}

// The app opens signed in as a Citizen Voter, so reaching role selection is always one sign-out.
Given('I launch the application', async ({ page }) => {
  await page.goto('/');
  await signOut(page);
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
  await expect(page.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveText(badgeText);
});

Then('I see the global voting age rules for countries', async ({ page }) => {
  await expect(page.getByText('NP')).toBeVisible();
  await expect(page.getByText('BR')).toBeVisible();
});

When('I click the sign out button', async ({ page }) => {
  await page.getByTestId(ScreenIds.eligibility.signOutButton).click();
});
