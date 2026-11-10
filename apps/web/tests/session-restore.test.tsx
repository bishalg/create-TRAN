// Verifies: REQ-SEC-014 REQ-SEC-016 REQ-SEC-017 REQ-SEC-018 REQ-SEC-021 REQ-SEC-022 (web half)
/**
 * The web session end to end against the in-memory API: boot restores from the refresh cookie,
 * choosing a role is a device sign-in with the API session behind it, and sign-out forgets the
 * session first. Log and reporter output is captured to prove no token ever reaches it.
 */
import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenIds, setErrorReporter, type ReportEvent } from '@tran/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from '../src/app/App.js';
import { createFakeApi, envelope, type FakeApiOptions } from './helpers/fakeApi.js';

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };
const WELCOME = { level: 2, name: 'Welcome to TRAN Voting' } as const;

type FakeApi = ReturnType<typeof createFakeApi>;

/** Every console line and reporter event the run produced, as one string. */
function captureOutput() {
  const reported: ReportEvent[] = [];
  setErrorReporter((event, cause) => reported.push({ ...event, cause } as ReportEvent));
  const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {})
  );
  return () =>
    JSON.stringify([
      reported,
      spies.map((spy) =>
        spy.mock.calls.map((args) => args.map(String).concat(JSON.stringify(args)))
      ),
    ]);
}

/** Each access token the fake API issued (they all start `access-token-`). */
const TOKEN = /access-token-\d+/;

/** Answers a request instead of the fake API, or gives `undefined` (now or later) to let it. */
type Intercept = (path: string, init: RequestInit | undefined) => Promise<unknown> | undefined;

function boot(
  options: FakeApiOptions = {},
  { strict = false, intercept = undefined as Intercept | undefined } = {}
) {
  const api = createFakeApi(options);
  const real = api.fetchFn.getMockImplementation()!;
  if (intercept) {
    api.fetchFn.mockImplementation(async (url, init) => {
      const answer = await intercept(new URL(url).pathname, init);
      return (answer ?? real(url, init)) as ReturnType<typeof real>;
    });
  }
  vi.stubGlobal('fetch', api.fetchFn);
  const app = <App retry={instant} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { api, user: userEvent.setup() };
}

const isWhoAmI = (path: string, init: RequestInit | undefined) =>
  path === '/api/auth/session' && init?.method !== 'POST';

const authCalls = (api: FakeApi, path: string, method = 'POST') =>
  api.callsTo(path).filter(([, init]) => (init?.method ?? 'GET') === method);

afterEach(() => setErrorReporter(null));

describe('boot restores the session (REQ-SEC-021)', () => {
  it('shows nothing to choose until the refresh answers (the Splash)', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    let held = false;
    boot(
      { cookie: 'citizen_voter' },
      {
        intercept: (path) => {
          if (path !== '/api/auth/refresh' || held) return undefined;
          held = true;
          return gate.then(() => undefined);
        },
      }
    );

    expect(screen.queryByTestId(ScreenIds.authWelcome.voterBranchButton)).toBeNull();
    expect(screen.queryByTestId(ScreenIds.eligibility.signOutButton)).toBeNull();
    answer();
    expect(await screen.findByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Voter');
  });

  it('restores a voter to the voter dashboard, then validates the session with the bearer', async () => {
    const { api } = boot({ cookie: 'citizen_voter' });
    expect(await screen.findByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent(
      'Citizen Voter'
    );
    const [refresh] = authCalls(api, '/api/auth/refresh');
    expect(refresh![1]).toMatchObject({ method: 'POST', credentials: 'include' });
    await waitFor(() => expect(authCalls(api, '/api/auth/session', 'GET')).toHaveLength(1));
    const [, who] = authCalls(api, '/api/auth/session', 'GET')[0]!;
    expect((who!.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('restores an auditor to the auditor dashboard', async () => {
    boot({ cookie: 'election_auditor' });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Election Auditor Dashboard' })
    ).toBeVisible();
  });

  it('leads to Auth Welcome without a session, quietly', async () => {
    const output = captureOutput();
    const { api } = boot();
    expect(await screen.findByRole('heading', WELCOME)).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(authCalls(api, '/api/auth/session', 'GET')).toHaveLength(0);
    expect(output()).not.toContain('auth.session_expired');
  });

  it('leads to Auth Welcome when the API is unreachable, and logs it', async () => {
    const output = captureOutput();
    boot({ down: true });
    expect(await screen.findByRole('heading', WELCOME)).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(output()).toContain('network.offline'));
  });

  it('sends one refresh even under React’s development double effects (REQ-SEC-016)', async () => {
    const { api } = boot({ cookie: 'citizen_voter' }, { strict: true });
    await screen.findByTestId(ScreenIds.eligibility.roleBadge);
    expect(authCalls(api, '/api/auth/refresh')).toHaveLength(1);
  });
});

describe('a restored session the server no longer accepts (REQ-SEC-015, REQ-ERR-010)', () => {
  /** Boot restores, then the server forgets the session: who-am-I and the next refresh say 401. */
  function bootRevoked(afterRestore: () => Promise<unknown>) {
    let refreshes = 0;
    return boot(
      { cookie: 'citizen_voter' },
      {
        intercept: (path, init) => {
          if (path === '/api/auth/refresh' && ++refreshes > 1) return afterRestore();
          if (isWhoAmI(path, init)) return Promise.resolve(envelope(401, 'auth.session_expired'));
          return undefined;
        },
      }
    );
  }
  const rejected = async () => envelope(401, 'auth.session_expired');

  it('refreshes once, then asks the user to sign in again; confirming leads to Auth Welcome', async () => {
    const output = captureOutput();
    const { api, user } = bootRevoked(rejected);
    const dialog = await screen.findByRole('dialog');
    expect(authCalls(api, '/api/auth/refresh')).toHaveLength(2);
    // Refused, and the one refresh is rejected too: the session is over, nothing is repeated.
    expect(authCalls(api, '/api/auth/session', 'GET')).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByRole('heading', WELCOME)).toBeVisible();
    await waitFor(() => expect(authCalls(api, '/api/auth/sign-out')).toHaveLength(1));
    expect(output()).not.toMatch(TOKEN);
  });

  it('keeps the device session when the user chooses "Not now"', async () => {
    const { user } = bootRevoked(rejected);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');
  });

  it('only logs when the refresh got no answer, and keeps the dashboard', async () => {
    const output = captureOutput();
    bootRevoked(() => Promise.reject(new TypeError('Failed to fetch')));
    await screen.findByTestId(ScreenIds.eligibility.roleBadge);
    await waitFor(() => expect(output()).toContain('network.offline'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');
  });

  it('ignores a validation that fails after the user signed out', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const booted = boot(
      { cookie: 'citizen_voter' },
      {
        intercept: (path, init) =>
          isWhoAmI(path, init)
            ? gate.then(() => Promise.reject(new TypeError('Failed to fetch')))
            : undefined,
      }
    );
    await screen.findByTestId(ScreenIds.eligibility.roleBadge);
    await booted.user.click(screen.getByTestId(ScreenIds.eligibility.signOutButton));
    await booted.user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' })
    );
    answer();
    await waitFor(() => expect(authCalls(booted.api, '/api/auth/sign-out')).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', WELCOME)).toBeVisible();
  });
});

describe('choosing a role signs in on the device first (ADR-0039 decision 7)', () => {
  it('opens the dashboard at once and establishes the cookie session behind it', async () => {
    const output = captureOutput();
    const { api, user } = boot();
    await user.click(await screen.findByTestId(ScreenIds.authWelcome.voterBranchButton));
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');

    await waitFor(() => expect(authCalls(api, '/api/auth/session')).toHaveLength(1));
    const [, init] = authCalls(api, '/api/auth/session')[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ role: 'citizen_voter', transport: 'cookie' });
    expect(init!.credentials).toBe('include');
    // Nothing a script can read holds the session (REQ-SEC-017, REQ-SEC-018).
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toMatch(TOKEN);
    expect(document.cookie).toBe('');
    expect(output()).not.toMatch(TOKEN);
  });

  it('works with the API unreachable: the dashboard opens, only the status says offline', async () => {
    const output = captureOutput();
    const { user } = boot({ down: true });
    await user.click(await screen.findByTestId(ScreenIds.authWelcome.auditorBranchButton));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Election Auditor Dashboard' })
    ).toBeVisible();
    await waitFor(() => expect(output()).toContain('network.offline'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('signing out clears the device first (REQ-SEC-022)', () => {
  it('returns to Auth Welcome even when the server cannot be told', async () => {
    const output = captureOutput();
    const { api, user } = boot({ cookie: 'citizen_voter' });
    await screen.findByTestId(ScreenIds.eligibility.roleBadge);
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await user.click(screen.getByTestId(ScreenIds.eligibility.signOutButton));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('heading', WELCOME)).toBeVisible();
    await waitFor(() => expect(authCalls(api, '/api/auth/sign-out')).toHaveLength(1));
    expect(authCalls(api, '/api/auth/sign-out')[0]![1]).toMatchObject({ credentials: 'include' });
    await waitFor(() => expect(output()).toContain('network.offline'));
    expect(output()).not.toMatch(TOKEN);
  });
});
