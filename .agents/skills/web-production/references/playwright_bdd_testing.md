# Playwright BDD & Page Object Model Guide

This guide establishes the E2E testing architecture for Next.js applications using Playwright, based on **Cal.com (`apps/web/playwright`)** and **Documenso (`documenso/documenso`)**.

---

## 1. Page Object Model (POM) + BDD Steps

Never write raw CSS/XPath selector interactions inside test files. Encapsulate page logic into Page Objects and wrap actions in `test.step()` for readable BDD test reports:

```typescript
import { Page, Locator, expect } from '@playwright/test';

export class VotingHomePage {
  readonly page: Page;
  readonly ageField: Locator;
  readonly countryField: Locator;
  readonly checkButton: Locator;
  readonly resultText: Locator;

  constructor(page: Page) {
    this.page = page;
    this.ageField = page.getByTestId('age-field');
    this.countryField = page.getByTestId('country-field');
    this.checkButton = page.getByTestId('check-button');
    this.resultText = page.getByTestId('offline-result');
  }

  async goto() {
    await this.page.goto('/');
  }

  async enterDetails(age: string, country: string) {
    await this.ageField.fill(age);
    await this.countryField.fill(country);
  }

  async submitCheck() {
    await this.checkButton.click();
  }

  async expectResult(expectedText: string) {
    await expect(this.resultText).toHaveText(expectedText);
  }
}
```

---

## 2. Writing BDD Test Scenarios

```typescript
import { test } from '@playwright/test';
import { VotingHomePage } from './VotingHomePage';

test.describe('Offline Voting Eligibility BDD Journey', () => {
  test('Eligible voter in Nepal', async ({ page }) => {
    const votingPage = new VotingHomePage(page);

    await test.step('Given the user is on the voting page', async () => {
      await votingPage.goto();
    });

    await test.step('When the user enters age 20 and country NP', async () => {
      await votingPage.enterDetails('20', 'NP');
      await votingPage.submitCheck();
    });

    await test.step('Then eligibility is confirmed', async () => {
      await votingPage.expectResult('Age 20 meets the minimum voting age of 18 in NP.');
    });
  });
});
```
