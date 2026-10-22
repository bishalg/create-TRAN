// Verifies: REQ-LOAD-002 REQ-LOAD-003 REQ-LOAD-004 REQ-LOAD-005 REQ-ERR-005 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-WEB-001 REQ-WEB-002 REQ-WEB-003 REQ-WEB-006 REQ-A11Y-002 REQ-A11Y-003 REQ-A11Y-004 REQ-A11Y-006 REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, envelope, REQUEST_ID } from '../../tests/helpers/fakeApi.js';
import { App, type AppProps } from './App.js';

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };

type User = ReturnType<typeof userEvent.setup>;

async function renderApp(opts: Parameters<typeof createFakeApi>[0] = {}, props: AppProps = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  const user = userEvent.setup();
  render(<App retry={instant} {...props} />);
  // Startup settles as "API online" or "API offline".
  await screen.findByText(/API (online|offline)/);
  return { api, user };
}

const ageInput = () => screen.getByLabelText('Your age');
const countryInput = () => screen.getByLabelText('Country code');
const submit = () => screen.getByRole('button', { name: /Check eligibility|Checking/ });

/** Holds every eligibility answer until `release()`; health and info answer at once. */
function gateEligibility(api: ReturnType<typeof createFakeApi>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const real = createFakeApi();
  api.fetchFn.mockImplementation(async (...args: Parameters<typeof real.fetchFn>) => {
    if (new URL(String(args[0])).pathname === '/api/vote/eligibility') await gate;
    return real.fetchFn(...args);
  });
  return () => release();
}

/** Lets every pending promise settle (one macrotask), without waiting on a clock. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const fallbackLabel = 'The server could not answer — checked on this device.';

const showNow: AppProps['loading'] = { indicatorDelayMs: 0 };
const neverShow: AppProps['loading'] = { indicatorDelayMs: 1e9 };

async function check(user: User, age: string, country?: string) {
  await user.clear(ageInput());
  if (age) await user.type(ageInput(), age);
  if (country !== undefined) {
    await user.clear(countryInput());
    if (country) await user.type(countryInput(), country);
  }
  await user.click(submit());
}

describe('App: shell', () => {
  it('shows the title, the subtitle and the API status', async () => {
    await renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
    expect(screen.getByText('Check the minimum voting age for a country.')).toBeVisible();
    expect(screen.getByText('API online · v0.1.0')).toBeVisible();
  });

  it('shows "Checking API…" until the first response arrives', () => {
    vi.stubGlobal('fetch', createFakeApi().fetchFn);
    render(<App />);
    expect(screen.getByText('Checking API…')).toBeVisible();
  });

  it('switches language and marks the active one', async () => {
    const { user } = await renderApp();
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'NE' }));
    expect(screen.getByRole('heading', { level: 1, name: 'मतदान योग्यता' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'NE' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
  });

  it('applies any registry theme to <html data-theme> and remembers the choice', async () => {
    const { user } = await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');

    const themes = screen.getByRole('group', { name: 'Theme' });
    await user.click(within(themes).getByRole('button', { name: 'Sepia' }));
    expect(document.documentElement.dataset.theme).toBe('sepia');
    expect(localStorage.getItem('tran.theme')).toBe('sepia');

    await user.click(within(themes).getByRole('button', { name: 'Black' }));
    expect(document.documentElement.dataset.theme).toBe('black');
    expect(localStorage.getItem('tran.theme')).toBe('black');
  });

  it('starts in the theme the OS prefers when nothing is remembered', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('App: accessibility behaviour', () => {
  it('sets the document language to the selected locale', async () => {
    const { user } = await renderApp();
    expect(document.documentElement.lang).toBe('en');

    await user.click(screen.getByRole('button', { name: 'NE' }));
    expect(document.documentElement.lang).toBe('ne');

    await user.click(screen.getByRole('button', { name: 'HI' }));
    expect(document.documentElement.lang).toBe('hi');
  });

  it('moves focus to the age field when the age is invalid', async () => {
    const { user } = await renderApp();
    await check(user, 'abc');
    expect(ageInput()).toHaveFocus();
  });

  it('keeps focus where it is when the input is valid', async () => {
    const { user } = await renderApp();
    await check(user, '30');
    expect(submit()).toHaveFocus();
  });

  it('exposes the result as a live region that exists before the first check', async () => {
    const { user } = await renderApp();
    const region = screen.getByRole('status', { name: 'Result' });
    expect(region).toBeEmptyDOMElement();

    await check(user, '30');
    expect(region).toHaveTextContent('Eligible to vote');
  });
});

describe('App: on this device', () => {
  it('declares an adult eligible and explains why, without any network call', async () => {
    const { api, user } = await renderApp();
    const before = api.fetchFn.mock.calls.length;

    await check(user, '20', 'NP');

    expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('Age 20 meets the minimum voting age of 18 in NP.')).toBeVisible();
    expect(screen.getByText('Checked on this device')).toBeVisible();
    expect(api.fetchFn.mock.calls.length).toBe(before);
  });

  it('declares a minor not eligible', async () => {
    const { user } = await renderApp();
    await check(user, '17');
    expect(screen.getByRole('heading', { name: 'Not eligible to vote' })).toBeVisible();
  });

  it('applies the Brazilian voting age of 16 and shows the minimum age', async () => {
    const { user } = await renderApp();
    await check(user, '16', 'br');
    expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('16', { selector: 'b' })).toBeVisible();
  });

  it('upper-cases the country and limits it to two letters', async () => {
    const { user } = await renderApp();
    await user.clear(countryInput());
    await user.type(countryInput(), 'npx');
    expect(countryInput()).toHaveValue('NP');
  });

  it.each([
    ['', 'empty'],
    ['abc', 'non-numeric'],
    ['-3', 'negative'],
    ['200', 'too old'],
    ['21.5', 'fractional'],
  ])('explains an invalid age (%j: %s) and shows no verdict', async (value) => {
    const { user } = await renderApp();
    await check(user, value);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a whole-number age between 0 and 150.'
    );
    expect(ageInput()).toBeInvalid();
    expect(screen.queryByRole('heading', { name: /to vote/ })).toBeNull();
  });

  it('clears the age error once the input is valid', async () => {
    const { user } = await renderApp();
    await check(user, 'abc');
    await check(user, '30');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ageInput()).toBeValid();
  });

  it('explains a malformed country code next to the field', async () => {
    const { user } = await renderApp();
    await check(user, '30', 'U1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Country must be two letters');
    expect(countryInput()).toBeInvalid();
    expect(ageInput()).toBeValid();
  });
});

describe('App: ask the server', () => {
  it('sends the country as the debug header and shows the server verdict', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    expect(screen.getByText(/X-Debug-Country header/)).toBeVisible();

    await check(user, '16', 'BR');

    expect(await screen.findByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('Checked by the server')).toBeVisible();
    const [call] = api.callsTo('/api/vote/eligibility');
    expect((call[1]?.headers as Record<string, string>)['X-Debug-Country']).toBe('BR');
  });

  it('disables the button at once and says "Checking…" once the indicator delay has passed', async () => {
    const { api, user } = await renderApp({}, { loading: showNow });
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    const release = gateEligibility(api);

    await user.click(submit());
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDisabled();
    // No verdict yet: the pending copy stands alone in the live region (REQ-LOAD-002).
    const region = screen.getByRole('status', { name: 'Result' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('Checking with the server…');

    release();
    expect(await screen.findByRole('button', { name: 'Check eligibility' })).toBeEnabled();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(region).not.toHaveTextContent('Checking with the server…');
  });

  it('[REQ-LOAD-002] a check that settles within the delay never shows progress', async () => {
    const { api, user } = await renderApp({}, { loading: neverShow });
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    const release = gateEligibility(api);

    await user.click(submit());
    const region = screen.getByRole('status', { name: 'Result' });
    expect(screen.getByRole('button', { name: 'Check eligibility' })).toBeDisabled();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText('Checking with the server…')).toBeNull();
    expect(screen.queryByText('Checking…')).toBeNull();

    release();
    expect(await screen.findByText('Checked by the server')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check eligibility' })).toBeEnabled();
  });

  it('[REQ-LOAD-003] a second server check keeps the previous verdict visible and marks the region busy', async () => {
    const { api, user } = await renderApp({}, { loading: showNow });
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    await check(user, '30', 'US');
    const before = 'Age 30 meets the minimum voting age of 18 in US.';
    expect(await screen.findByText('Checked by the server')).toBeVisible();

    const release = gateEligibility(api);
    await check(user, '17', 'US');
    const region = screen.getByRole('status', { name: 'Result' });
    await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByText(before)).toBeVisible();
    expect(screen.getByText('Checking with the server…')).toBeVisible();
    expect(screen.queryByText('Checked by the server')).toBeNull();
    expect(region.querySelector('article')).toHaveAttribute('data-updating', 'true');

    release();
    expect(
      await screen.findByText('Age 17 is below the minimum voting age of 18 in US.')
    ).toBeVisible();
    expect(screen.queryByText(before)).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(region.querySelector('article')).not.toHaveAttribute('data-updating');
    expect(screen.getByText('Checked by the server')).toBeVisible();
  });

  it('[REQ-LOAD-003] a pending server check leaves the device result alone', async () => {
    const { api, user } = await renderApp({}, { loading: showNow });
    await check(user, '30'); // device result
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    gateEligibility(api);
    await user.click(submit());
    await screen.findByRole('button', { name: 'Checking…' });

    await user.click(screen.getByRole('radio', { name: /On this device/ }));
    const region = screen.getByRole('status', { name: 'Result' });
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('Checked on this device')).toBeVisible();
    expect(region.querySelector('article')).not.toHaveAttribute('data-updating');
  });

  it('shows a rejected input inline, in the user’s language, without claiming the API is offline', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    await check(user, '30', 'U1');

    // The server's English `error` is never shown: the code picks the localized copy.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Country must be two letters');
    expect(alert).not.toHaveTextContent('server says');
    expect(screen.queryByText(/API unreachable/)).toBeNull();
    expect(screen.getByText(/API online/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'NE' }));
    expect(screen.getByRole('alert')).toHaveTextContent('देश दुई अक्षरको हुनुपर्छ');
  });

  it('acknowledges a server check with a short success toast', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    await check(user, '30', 'US');

    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(region).findByText('Server check complete')).toBeVisible();
  });

  it('retries a flaky server without bothering the user', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    const healthy = createFakeApi();
    api.fetchFn
      .mockResolvedValueOnce(envelope(503, 'server.unavailable', true))
      .mockImplementation(healthy.fetchFn);

    await check(user, '30', 'US');

    expect(await screen.findByText('Checked by the server')).toBeVisible();
    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('after a server error, explains it with a reference and answers on the device', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    api.fetchFn.mockResolvedValue(envelope(500, 'server.internal', true));

    await check(user, '17', 'US');

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Something went wrong on our side.');
    expect(toast).toHaveTextContent(`Reference: ${REQUEST_ID}`);
    expect(screen.getByRole('heading', { name: 'Not eligible to vote' })).toBeVisible();
    expect(screen.getByText(fallbackLabel)).toBeVisible();
  });

  it('[REQ-LOAD-005] after the retries the card says the server could not answer, until the server answers again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    api.fetchFn.mockResolvedValue(envelope(500, 'server.internal', true));

    await check(user, '30', 'US');

    expect(await screen.findByText(fallbackLabel)).toBeVisible();
    expect(screen.queryByText('Checked on this device')).toBeNull();
    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(3);

    api.fetchFn.mockImplementation(createFakeApi().fetchFn);
    await user.click(submit());
    expect(await screen.findByText('Checked by the server')).toBeVisible();
    expect(screen.queryByText(fallbackLabel)).toBeNull();
  });

  it('keeps each mode’s last result separate', async () => {
    const { user } = await renderApp();
    await check(user, '30'); // device result
    expect(screen.getByText('Checked on this device')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    expect(screen.queryByText('Checked on this device')).toBeNull();

    await user.click(screen.getByRole('radio', { name: /On this device/ }));
    expect(screen.getByText('Checked on this device')).toBeVisible();
  });
});

describe('App: server down', () => {
  it('shows the banner and the offline status, and the device check still works', async () => {
    const { user } = await renderApp({ down: true });
    expect(await screen.findByText(/API unreachable/)).toBeVisible();
    expect(screen.getByText('API offline')).toBeVisible();

    await check(user, '30');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible()
    );
  });

  it('switches to the offline banner (not an error alert) and the device verdict when the server dies mid-session', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await user.click(submit());

    expect(await screen.findByText(/API unreachable/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(fallbackLabel)).toBeVisible();
    expect(screen.getByText('API offline')).toBeVisible();
  });
});

describe('App: navigation and role branching', () => {
  it('[REQ-NAV-001] [REQ-NAV-002] renders auth welcome when initial session is unauthenticated', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    render(<App retry={instant} initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue as Citizen Voter' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue as Election Auditor' })).toBeVisible();
  });

  it('[REQ-NAV-003] branches into Citizen Voter dashboard upon selection', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    await user.click(screen.getByRole('button', { name: 'Continue as Citizen Voter' }));
    expect(screen.getByLabelText('Your age')).toBeVisible();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Citizen Voter');
  });

  it('[REQ-NAV-004] branches into Election Auditor dashboard upon selection', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    await user.click(screen.getByRole('button', { name: 'Continue as Election Auditor' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Election Auditor Dashboard' })
    ).toBeVisible();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Election Auditor');
    expect(screen.getByText('NP')).toBeVisible();

    // Can switch back to Citizen Voter from Auditor dashboard
    await user.click(screen.getByRole('button', { name: 'Switch to Citizen Voter' }));
    expect(screen.getByLabelText('Your age')).toBeVisible();
  });

  it('[REQ-NAV-005] signing out asks first, and cancelling keeps the session', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Citizen Voter');
  });

  it('[REQ-LOAD-004] signing out during a server check shows no late toast', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    const release = gateEligibility(api);
    await user.click(submit());

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    release();
    await settle();

    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })).toBeVisible();
    const [, init] = api.callsTo('/api/vote/eligibility')[0];
    expect(init?.signal?.aborted).toBe(true);
    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(within(notifications).queryByText('Server check complete')).toBeNull();
    expect(screen.getByText(/API online/)).toBeVisible();
  });

  it('[REQ-NAV-005] confirming sign-out returns to the auth welcome screen', async () => {
    const { user } = await renderApp();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Citizen Voter');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })).toBeVisible();
    expect(screen.queryByTestId('role-badge')).toBeNull();
  });
});
