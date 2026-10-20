import { expect, type Page, type Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

const API = 'http://127.0.0.1:3001';
const ELIGIBILITY = `${API}/api/vote/eligibility`;

/** A cross-origin reply in the API's error envelope (REQ-ERR-002). */
function envelope(route: Route, status: number, code: string, requestId: string) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-request-id',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      success: false,
      error: `staged ${code}`,
      code,
      retryable: true,
      request_id: requestId,
    }),
  });
}

/** Real eligibility requests in the current scenario (a worker runs scenarios one at a time). */
let attempts = 0;

/** Stages the eligibility route; CORS preflights pass through and are not counted. */
async function stage(page: Page, handle: (route: Route, attempt: number) => Promise<void>) {
  attempts = 0;
  await page.route(ELIGIBILITY, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    attempts += 1;
    await handle(route, attempts);
  });
}

Given('the server fails once with {int}', async ({ page }, status: number) => {
  await stage(page, (route, attempt) =>
    attempt === 1
      ? envelope(route, status, 'server.unavailable', 'req-e2e-flaky')
      : route.continue()
  );
});

Given(
  'the server always fails with {int} and request id {string}',
  async ({ page }, status: number, requestId: string) => {
    await stage(page, (route) => envelope(route, status, 'server.internal', requestId));
  }
);

Given('the API goes away', async ({ page }) => {
  await page.route(`${API}/**`, (route) => route.abort('connectionrefused'));
});

Then('the server was asked {int} times', async ({}, count: number) => {
  expect(attempts).toBe(count);
});

When(
  'I ask the server in Nepali with age {string} and country {string}',
  async ({ page }, age: string, country: string) => {
    await page.getByRole('radio', { name: /सर्भर/ }).check();
    await page.getByLabel('तपाईंको उमेर').fill(age);
    await page.getByLabel(/देश कोड/).fill(country);
    await page.getByRole('button', { name: 'योग्यता जाँच्नुहोस्' }).click();
  }
);

const toastRegion = (page: Page) => page.getByRole('region', { name: 'Notifications' });

Then(/^an? "([^"]+)" toast says "([^"]+)"$/, async ({ page }, tone: string, text: string) => {
  const toast = toastRegion(page).locator(`[data-tone="${tone}"]`);
  await expect(toast).toContainText(text);
});

Then('the toast shows {string}', async ({ page }, text: string) => {
  await expect(toastRegion(page)).toContainText(text);
});

Then('the toast disappears after about {int} seconds', async ({ page }, seconds: number) => {
  // Move the pointer away: hovering a toast pauses it (REQ-ERR-006).
  await page.mouse.move(0, 0);
  await expect(toastRegion(page).locator('[data-tone]')).toHaveCount(0, {
    timeout: (seconds + 1) * 1000,
  });
});

Then('a dialog asks {string}', async ({ page }, title: string) => {
  await expect(page.getByRole('dialog', { name: title })).toBeVisible();
});

When('I confirm the dialog with {string}', async ({ page }, label: string) => {
  await page.getByRole('dialog').getByRole('button', { name: label }).click();
});

When('I press Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
});

Then('no dialog is open', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

Then('the sign out button has focus', async ({ page }) => {
  await expect(page.getByTestId('sign-out-button')).toBeFocused();
});
