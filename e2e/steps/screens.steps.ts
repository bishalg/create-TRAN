// Verifies: REQ-SCR-006 REQ-SCR-007 (web part)
/**
 * The web interpreter of the screen contract (ADR-0038): one definition per verb of the Gherkin
 * that `pnpm tokens:sync` renders to `e2e/features/screens/`, and nothing per scenario. Each step
 * finds its scenario in the generated `SCREENS` by the scenario's title, so the locale, the time
 * bound and the screen's elements come from the same data the Gherkin came from.
 *
 * Elements are found by `data-testid` (the contract id). `text_is` and `announced` resolve their
 * key through the shared dictionaries with `t()`, as `apps/web` does. Touch minimums and the
 * largest text scale come from `PLATFORM_MINIMUMS.web`; no number lives here.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import {
  PLATFORM_MINIMUMS,
  SCREENS,
  ScreenIds,
  t,
  TRAN_LOCALES,
  type Scenario,
  type Screen,
  type ScreenElement,
  type SessionKind,
  type SupportedLocale,
  type TranStringKey,
} from '@tran/core';

const { Given, When, Then } = createBdd();

const API = 'http://127.0.0.1:3001';
const WEB = PLATFORM_MINIMUMS.find((minimum) => minimum.platform === 'web')!;

/** One quoted value as the renderer writes it: `\"` and `\\` are escaped. */
const Q = '"((?:[^"\\\\]|\\\\.)*)"';
const unquote = (value: string) => value.replace(/\\(.)/g, '$1');
const step = (pattern: string) => new RegExp(`^${pattern}$`);

/** The state of the scenario a worker is running (a worker runs one scenario at a time). */
interface Run {
  testId: string;
  scenario: Scenario;
  screen: Screen;
  session: SessionKind;
  locale: SupportedLocale;
  theme?: string;
  largestText: boolean;
  launched: boolean;
  checkedReach: boolean;
}

let run: Run | undefined;

function find(title: string): { scenario: Scenario; screen: Screen } {
  for (const screen of SCREENS) {
    const scenario = screen.scenarios.find((candidate) => candidate.name === title);
    if (scenario) return { scenario, screen };
  }
  throw new Error(`no screen contract scenario is named "${title}": run \`pnpm tokens:sync\``);
}

function current(testInfo: TestInfo): Run {
  if (run?.testId !== testInfo.testId) {
    run = {
      testId: testInfo.testId,
      ...find(testInfo.title),
      session: 'citizen_voter',
      locale: 'en',
      largestText: false,
      launched: false,
      checkedReach: false,
    };
  }
  return run;
}

/** Names the scenario, the step and the element, so a failure says where it is. */
const where = (r: Run, stepTitle: string, id?: string) =>
  `${r.scenario.name} › ${stepTitle}${id === undefined ? '' : ` › element "${id}"`}`;

function declared(id: string): ScreenElement {
  for (const screen of SCREENS) {
    const element = screen.elements.find((candidate) => candidate.id === id);
    if (element) return element;
  }
  throw new Error(`"${id}" is not an element of the screen contract`);
}

const byId = (page: Page, id: string) => page.getByTestId(id);

/** A `control` or `primary` element meets the web minimum on both axes (REQ-SCR-007). */
async function assertMinimum(r: Run, stepTitle: string, id: string, element: Locator) {
  const { touch } = declared(id);
  if (touch === 'none') return;
  const minimum = touch === 'primary' ? WEB.primary_action : WEB.control;
  const box = await element.boundingBox();
  const label = where(r, stepTitle, id);
  expect(box, `${label}: no box to measure`).not.toBeNull();
  expect(box!.width, `${label}: width below ${touch} minimum`).toBeGreaterThanOrEqual(minimum);
  expect(box!.height, `${label}: height below ${touch} minimum`).toBeGreaterThanOrEqual(minimum);
}

/** What the browser does at the largest text scale: `200%` zoom halves the CSS viewport. */
async function applyLargestText(page: Page) {
  const scale = WEB.largest_text_scale;
  if (!('percent' in scale)) throw new Error('the web scale must be a percentage');
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: Math.round((viewport.width * 100) / scale.percent),
    height: Math.round((viewport.height * 100) / scale.percent),
  });
}

/** Every always-present element of the screen is on screen and within the viewport's width. */
async function assertReachable(page: Page, r: Run, stepTitle: string) {
  const width = page.viewportSize()!.width;
  for (const element of r.screen.elements.filter((e) => e.presence === 'always')) {
    const locator = byId(page, element.id);
    const label = where(r, stepTitle, element.id);
    await locator.scrollIntoViewIfNeeded({ timeout: r.scenario.within_ms });
    await expect(locator, `${label}: not visible at the largest text scale`).toBeVisible();
    const box = (await locator.boundingBox())!;
    expect(box.x, `${label}: starts off screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label}: ends off screen`).toBeLessThanOrEqual(width);
    await assertMinimum(r, stepTitle, element.id, locator);
  }
}

/** Sign-out always asks first (REQ-ERR-007). */
async function signOut(page: Page) {
  await byId(page, ScreenIds.eligibility.signOutButton).click();
  await byId(page, ScreenIds.eligibility.dialogConfirm).click();
}

/**
 * Opens the app in the scenario's given state. Runs before the first `When` or `Then`, so the
 * givens can be in any order. The web keeps no session: it opens as a Citizen Voter, and the other
 * sessions are reached the way a person would.
 */
async function launch(page: Page, r: Run) {
  if (r.launched) return;
  r.launched = true;
  if (r.largestText) await applyLargestText(page);
  await page.goto('/');
  if (r.session !== 'citizen_voter') await signOut(page);
  if (r.session === 'election_auditor')
    await byId(page, ScreenIds.authWelcome.auditorBranchButton).click();
  if (r.locale !== 'en') {
    await page
      .getByRole('group', { name: t('shell.language.label', 'en') })
      .getByRole('button', { name: r.locale.toUpperCase(), exact: true })
      .click();
  }
  if (r.theme)
    await byId(page, ScreenIds.eligibility.themePicker).locator(`[value="${r.theme}"]`).click();
}

/** Before the first `Then`: at the largest text scale, everything must still be reachable. */
async function beforeThen(page: Page, r: Run, stepTitle: string) {
  await launch(page, r);
  if (r.largestText && !r.checkedReach) {
    r.checkedReach = true;
    await assertReachable(page, r, stepTitle);
  }
}

/** `age="20", minimumAge="18"` → `{ age: '20', minimumAge: '18' }`. */
function parseArgs(list: string | undefined): Record<string, string> {
  const args: Record<string, string> = {};
  for (const match of (list ?? '').matchAll(new RegExp(`(\\w+)=${Q}`, 'g'))) {
    args[match[1]!] = unquote(match[2]!);
  }
  return args;
}

function message(r: Run, key: string, args: string | undefined): string {
  return t(key as TranStringKey, r.locale, parseArgs(args));
}

// ── Given ──────────────────────────────────────────────────────────────────────────────────────

Given(step(`the stored session is ${Q}`), async ({ $testInfo }, session: string) => {
  current($testInfo).session = unquote(session) as SessionKind;
});

Given('the API is reachable', async ({ $testInfo }) => {
  current($testInfo);
});

Given('the API is unreachable', async ({ page, $testInfo }) => {
  current($testInfo);
  await page.route(`${API}/**`, (route) => route.abort('connectionrefused'));
});

Given(step(`the locale is ${Q}`), async ({ $testInfo }, locale: string) => {
  const value = unquote(locale);
  if (!(TRAN_LOCALES as readonly string[]).includes(value))
    throw new Error(`${current($testInfo).scenario.name}: unknown locale "${value}"`);
  current($testInfo).locale = value as SupportedLocale;
});

Given(step(`the theme is ${Q}`), async ({ $testInfo }, theme: string) => {
  current($testInfo).theme = unquote(theme);
});

Given('the largest text scale', async ({ $testInfo }) => {
  current($testInfo).largestText = true;
});

Given('reduced motion', async ({ page, $testInfo }) => {
  current($testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// ── When ───────────────────────────────────────────────────────────────────────────────────────

/** Launches, then finds a visible `id` that meets its minimum. */
async function target(page: Page, r: Run, stepTitle: string, id: string): Promise<Locator> {
  await launch(page, r);
  const element = byId(page, id);
  await expect(element, where(r, stepTitle, id)).toBeVisible({ timeout: r.scenario.within_ms });
  await assertMinimum(r, stepTitle, id, element);
  return element;
}

When(step(`I tap ${Q}`), async ({ page, $testInfo, $step }, id: string) => {
  await (await target(page, current($testInfo), $step.title, unquote(id))).click();
});

When(
  step(`I type ${Q} into ${Q}`),
  async ({ page, $testInfo, $step }, text: string, id: string) => {
    // `type` replaces the field's content.
    await (await target(page, current($testInfo), $step.title, unquote(id))).fill(unquote(text));
  }
);

When(
  step(`I select ${Q} in ${Q}`),
  async ({ page, $testInfo, $step }, option: string, id: string) => {
    const r = current($testInfo);
    const element = await target(page, r, $step.title, unquote(id));
    const choice = element.locator(`[value="${unquote(option)}"]`);
    await expect(choice, `${where(r, $step.title, unquote(id))}: no option`).toHaveCount(1);
    await choice.click();
  }
);

When(step(`I press ${Q} in ${Q}`), async ({ page, $testInfo, $step }, key: string, id: string) => {
  await (await target(page, current($testInfo), $step.title, unquote(id))).press(unquote(key));
});

When('I go offline', async ({ page, context, $testInfo }) => {
  await launch(page, current($testInfo));
  await context.setOffline(true);
});

When('I go online', async ({ page, context, $testInfo }) => {
  await launch(page, current($testInfo));
  await context.setOffline(false);
});

// ── Then ───────────────────────────────────────────────────────────────────────────────────────

Then(step(`${Q} exists`), async ({ page, $testInfo, $step }, quoted: string) => {
  const r = current($testInfo);
  const id = unquote(quoted);
  await beforeThen(page, r, $step.title);
  const element = byId(page, id);
  await expect(element, where(r, $step.title, id)).toBeVisible({ timeout: r.scenario.within_ms });
  await assertMinimum(r, $step.title, id, element);
});

Then(step(`${Q} is missing`), async ({ page, $testInfo, $step }, quoted: string) => {
  const r = current($testInfo);
  const id = unquote(quoted);
  await beforeThen(page, r, $step.title);
  await expect(byId(page, id), where(r, $step.title, id)).toBeHidden({
    timeout: r.scenario.within_ms,
  });
});

/** The web's announcement mechanism: a status, alert or log role, or an explicit `aria-live`. */
const LIVE = /^(role=(status|alert|log)|aria-live=(polite|assertive))$/;

/** A `live_region` element announces through the web's mechanism (REQ-SCR-007). */
async function assertLive(element: Locator, id: string, label: string) {
  if (declared(id).kind !== 'live_region') return;
  const mechanism = await element.evaluate((node) =>
    node.hasAttribute('role')
      ? `role=${node.getAttribute('role')}`
      : `aria-live=${node.getAttribute('aria-live')}`
  );
  expect(mechanism, `${label}: not a live region`).toMatch(LIVE);
}

/** `text_is` and `announced`: the element reads the message, resolved in the scenario's locale. */
async function assertMessage(
  page: Page,
  r: Run,
  stepTitle: string,
  quoted: string,
  key: string,
  args: string | undefined,
  mustAnnounce: boolean
) {
  const id = unquote(quoted);
  await beforeThen(page, r, stepTitle);
  const element = byId(page, id);
  const label = where(r, stepTitle, id);
  await expect(element, label).toHaveText(message(r, unquote(key), args), {
    timeout: r.scenario.within_ms,
  });
  if (mustAnnounce && declared(id).kind !== 'live_region')
    throw new Error(`${label}: only a live region announces`);
  await assertLive(element, id, label);
}

Then(
  step(`${Q} reads ${Q}(?: with (.+))?`),
  async ({ page, $testInfo, $step }, quoted: string, key: string, args?: string) => {
    await assertMessage(page, current($testInfo), $step.title, quoted, key, args, false);
  }
);

Then(step(`${Q} has focus`), async ({ page, $testInfo, $step }, quoted: string) => {
  const r = current($testInfo);
  const id = unquote(quoted);
  await beforeThen(page, r, $step.title);
  await expect(byId(page, id), where(r, $step.title, id)).toBeFocused({
    timeout: r.scenario.within_ms,
  });
});

Then(
  step(`${Q} announces ${Q}(?: with (.+))?`),
  async ({ page, $testInfo, $step }, quoted: string, key: string, args?: string) => {
    await assertMessage(page, current($testInfo), $step.title, quoted, key, args, true);
  }
);

Then(
  step(`${Q} count is (\\d+)`),
  async ({ page, $testInfo, $step }, quoted: string, n: string) => {
    const r = current($testInfo);
    const id = unquote(quoted);
    await beforeThen(page, r, $step.title);
    await expect(byId(page, id), where(r, $step.title, id)).toHaveCount(Number(n), {
      timeout: r.scenario.within_ms,
    });
  }
);
