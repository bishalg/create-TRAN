// Verifies: REQ-WEB-001 REQ-WEB-002 REQ-WEB-003 REQ-WEB-006 REQ-A11Y-002 REQ-A11Y-003 REQ-A11Y-004 REQ-A11Y-006 REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../tests/helpers/fakeApi.js';
import { App } from './App.js';

type User = ReturnType<typeof userEvent.setup>;

async function renderApp(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  const user = userEvent.setup();
  render(<App />);
  // Startup settles as "API online" or "API offline".
  await screen.findByText(/API (online|offline)/);
  return { api, user };
}

const ageInput = () => screen.getByLabelText('Your age');
const countryInput = () => screen.getByLabelText('Country code');
const submit = () => screen.getByRole('button', { name: /Check eligibility|Checking/ });

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

  it('toggles the theme on <html data-theme> and labels the next action', async () => {
    const { user } = await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('starts in the theme the OS prefers', async () => {
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

  it('explains a malformed country code', async () => {
    const { user } = await renderApp();
    await check(user, '30', 'U1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/country code/i);
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

  it('disables the button and says "Checking…" while the request is in flight', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = createFakeApi();
    api.fetchFn.mockImplementation(async (...args: Parameters<typeof real.fetchFn>) => {
      await gate;
      return real.fetchFn(...args);
    });

    await user.click(submit());
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    release();
    expect(await screen.findByRole('button', { name: 'Check eligibility' })).toBeEnabled();
  });

  it('shows the server message for a rejected input without claiming the API is offline', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    await check(user, '30', 'U1');

    expect(await screen.findByRole('alert')).toHaveTextContent(/country code/i);
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText(/API online/)).toBeVisible();
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
  it('shows the notice and the offline status, and the device check still works', async () => {
    const { user } = await renderApp({ down: true });
    expect(await screen.findByRole('note')).toHaveTextContent(/API unreachable/);
    expect(screen.getByText('API offline')).toBeVisible();

    await check(user, '30');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible()
    );
  });

  it('switches to the offline notice (not an error alert) when the server dies mid-session', async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await user.click(submit());

    expect(await screen.findByRole('note')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('App: navigation and role branching', () => {
  it('[REQ-NAV-001] [REQ-NAV-002] renders auth welcome when initial session is unauthenticated', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    render(<App initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue as Citizen Voter' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue as Election Auditor' })).toBeVisible();
  });

  it('[REQ-NAV-003] branches into Citizen Voter dashboard upon selection', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const user = userEvent.setup();
    render(<App initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    await user.click(screen.getByRole('button', { name: 'Continue as Citizen Voter' }));
    expect(screen.getByLabelText('Your age')).toBeVisible();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Citizen Voter');
  });

  it('[REQ-NAV-004] branches into Election Auditor dashboard upon selection', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const user = userEvent.setup();
    render(<App initialSession={{ status: 'unauthenticated' }} />);
    await screen.findByText(/API (online|offline)/);

    await user.click(screen.getByRole('button', { name: 'Continue as Election Auditor' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Election Auditor Dashboard' })).toBeVisible();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Election Auditor');
    expect(screen.getByText('NP')).toBeVisible();

    // Can switch back to Citizen Voter from Auditor dashboard
    await user.click(screen.getByRole('button', { name: 'Switch to Citizen Voter' }));
    expect(screen.getByLabelText('Your age')).toBeVisible();
  });

  it('[REQ-NAV-005] signing out returns to the auth welcome screen', async () => {
    const { user } = await renderApp();
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Citizen Voter');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to TRAN Voting' })).toBeVisible();
    expect(screen.queryByTestId('role-badge')).toBeNull();
  });
});
