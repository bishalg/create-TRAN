import { Page, Locator, expect, test } from '@playwright/test';

/**
 * Playwright BDD Page Object fixture with encapsulated step helpers.
 * Inspired by `calcom/cal.com` (`apps/web/playwright`).
 */
export class VotingDashboardPage {
  readonly page: Page;
  readonly ageInput: Locator;
  readonly countryInput: Locator;
  readonly submitButton: Locator;
  readonly resultMessage: Locator;
  readonly themeToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.ageInput = page.getByTestId('age-field');
    this.countryInput = page.getByTestId('country-field');
    this.submitButton = page.getByTestId('check-button');
    this.resultMessage = page.getByTestId('offline-result');
    this.themeToggle = page.getByTestId('theme-toggle');
  }

  async navigate() {
    await test.step('Navigate to voting dashboard', async () => {
      await this.page.goto('/');
    });
  }

  async checkEligibility(age: string, country: string) {
    await test.step(`Submit eligibility check for age ${age} in ${country}`, async () => {
      await this.ageInput.fill(age);
      await this.countryInput.fill(country);
      await this.submitButton.click();
    });
  }

  async expectResultText(expected: string | RegExp) {
    await test.step(`Verify eligibility result matches "${expected}"`, async () => {
      await expect(this.resultMessage).toHaveText(expected);
    });
  }
}
