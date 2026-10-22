import { expect, type Page, type Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

const ELIGIBILITY = 'http://127.0.0.1:3001/api/vote/eligibility';

/** CORS preflights pass straight through; only the real request is staged. */
async function stage(page: Page, handle: (route: Route) => Promise<void>) {
  await page.route(ELIGIBILITY, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await handle(route);
  });
}

/** The held request of the current scenario (a worker runs scenarios one at a time). */
let release: () => void = () => {};
let aborted = false;

const resultRegion = (page: Page) => page.getByRole('status', { name: 'Result' });

Given('I start watching the result region', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { __everBusy: boolean };
    w.__everBusy = false;
    const region = document.querySelector('[role="status"][aria-label="Result"]');
    if (!region) throw new Error('result region missing');
    new MutationObserver(() => {
      if (region.getAttribute('aria-busy') === 'true') w.__everBusy = true;
    }).observe(region, { attributes: true, attributeFilter: ['aria-busy'] });
  });
});

Given('the server answers after {int} milliseconds', async ({ page }, ms: number) => {
  await stage(page, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
});

Given('the server holds the next answer', async ({ page }) => {
  aborted = false;
  const gate = new Promise<void>((resolve) => (release = resolve));
  page.on('requestfailed', (request) => {
    if (request.url() === ELIGIBILITY && request.failure()?.errorText.includes('ABORTED')) {
      aborted = true;
    }
  });
  await stage(page, async (route) => {
    await gate;
    // The page may already have abandoned the request: answering it then is a no-op.
    await route.continue().catch(() => {});
  });
});

When('the server answers now', async () => {
  release();
});

Then('the result region was never busy', async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { __everBusy: boolean }).__everBusy)).toBe(
    false
  );
});

Then('the result region is busy and says {string}', async ({ page }, text: string) => {
  await expect(resultRegion(page)).toHaveAttribute('aria-busy', 'true');
  await expect(resultRegion(page)).toContainText(text);
});

Then('the result region is not busy', async ({ page }) => {
  await expect(resultRegion(page)).toHaveAttribute('aria-busy', 'false');
});

Then('the held request was aborted', async () => {
  await expect.poll(() => aborted).toBe(true);
});

Then('no toast is shown', async ({ page }) => {
  await expect(
    page.getByRole('region', { name: 'Notifications' }).locator('[data-tone]')
  ).toHaveCount(0);
});
