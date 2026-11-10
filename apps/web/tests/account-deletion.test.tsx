// Verifies: REQ-ACC-004 REQ-ACC-005 REQ-ACC-006 (web half)
/**
 * Deleting the account from the web app against the in-memory API: the control beside sign-out,
 * the catalogue's confirmation, and a device that follows the server only after it confirmed.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenIds } from '@tran/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from '../src/app/App.js';
import { createFakeApi, envelope, REQUEST_ID, type FakeApiOptions } from './helpers/fakeApi.js';

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };
const WELCOME = { level: 2, name: 'Welcome to TRAN Voting' } as const;

/** Every console line the run logged, as one string. */
let logged: () => string;

beforeEach(() => {
  const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {})
  );
  logged = () => JSON.stringify(spies.map((spy) => spy.mock.calls));
});

afterEach(() => vi.restoreAllMocks());

/** Boots with a refresh cookie for `role`, so the client holds a real access token. */
async function signedIn(role: NonNullable<FakeApiOptions['cookie']> = 'citizen_voter') {
  const api = createFakeApi({ cookie: role });
  vi.stubGlobal('fetch', api.fetchFn);
  render(<App retry={instant} />);
  await screen.findByTestId(ScreenIds.eligibility.roleBadge);
  // The boot validation has answered, so the token in memory is the one the server accepts.
  await waitFor(() => expect(api.callsTo('/api/auth/session')).toHaveLength(1));
  return { api, user: userEvent.setup() };
}

const deletions = (api: ReturnType<typeof createFakeApi>) => api.callsTo('/api/account');

async function deleteAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton));
  await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountConfirm));
}

describe('the control (REQ-ACC-004)', () => {
  it('sits beside sign-out on both signed-in screens, and nowhere signed out', async () => {
    const voter = await signedIn('citizen_voter');
    expect(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton)).toBeVisible();
    await voter.user.click(screen.getByTestId(ScreenIds.eligibility.signOutButton));
    await voter.user.click(screen.getByTestId(ScreenIds.eligibility.dialogConfirm));
    expect(screen.getByRole('heading', WELCOME)).toBeVisible();
    expect(screen.queryByTestId(ScreenIds.eligibility.deleteAccountButton)).toBeNull();
  });

  it('is on the auditor dashboard too', async () => {
    await signedIn('election_auditor');
    expect(screen.getByTestId(ScreenIds.auditor.deleteAccountButton)).toBeVisible();
  });
});

describe('it asks first (REQ-ACC-005)', () => {
  it('Cancel keeps the account and sends nothing', async () => {
    const { api, user } = await signedIn();
    await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    await user.click(within(dialog).getByTestId(ScreenIds.eligibility.deleteAccountCancel));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deletions(api)).toHaveLength(0);
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');
  });
});

describe('the device follows the server (REQ-ACC-006)', () => {
  it('confirming deletes the account and returns to role selection with a success toast', async () => {
    const { api, user } = await signedIn();
    await deleteAndConfirm(user);

    expect(await screen.findByRole('heading', WELCOME)).toBeVisible();
    const [[, init]] = deletions(api);
    expect(init).toMatchObject({ method: 'DELETE', credentials: 'omit' });
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(within(notifications).getByText('Your account was deleted')).toBeVisible();
    expect(screen.queryByTestId(ScreenIds.eligibility.deleteAccountButton)).toBeNull();
    // The deletion carried no cookie; the sign-out after it does, so the browser drops it.
    await waitFor(() => expect(api.callsTo('/api/auth/sign-out')).toHaveLength(1));
    expect(api.callsTo('/api/auth/sign-out')[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('starts no second deletion while one is in flight', async () => {
    const { api, user } = await signedIn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = api.fetchFn.getMockImplementation()!;
    api.fetchFn.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/api/account') await gate;
      return real(url, init);
    });
    await deleteAndConfirm(user);

    const control = screen.getByTestId(ScreenIds.eligibility.deleteAccountButton);
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute('aria-busy', 'true');
    await user.click(control);
    await user.click(control);
    expect(screen.queryByRole('dialog')).toBeNull();

    release();
    expect(await screen.findByRole('heading', WELCOME)).toBeVisible();
    expect(deletions(api)).toHaveLength(1);
  });

  it('frees the control again once a deletion failed', async () => {
    const { api, user } = await signedIn();
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    await deleteAndConfirm(user);
    await screen.findByTestId(ScreenIds.eligibility.offlineNotice);
    const control = screen.getByTestId(ScreenIds.eligibility.deleteAccountButton);
    await waitFor(() => expect(control).toBeEnabled());
    expect(control).not.toHaveAttribute('aria-busy', 'true');
  });

  it('confirming on the auditor dashboard returns to role selection too', async () => {
    const { user } = await signedIn('election_auditor');
    await deleteAndConfirm(user);
    expect(await screen.findByRole('heading', WELCOME)).toBeVisible();
  });

  it('offline: keeps the session and shows the offline notice, never the success toast', async () => {
    const { api, user } = await signedIn();
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    await deleteAndConfirm(user);

    expect(await screen.findByTestId(ScreenIds.eligibility.offlineNotice)).toBeVisible();
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');
    expect(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton)).toBeVisible();
    expect(screen.queryByText('Your account was deleted')).toBeNull();
    expect(logged()).toContain('network.offline');
  });

  it('offline on the auditor dashboard: the notice shows there as well', async () => {
    const { api, user } = await signedIn('election_auditor');
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    await deleteAndConfirm(user);

    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('API unreachable');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Election Auditor Dashboard' })
    ).toBeVisible();
  });

  it('a server error keeps the session and explains it with a reference', async () => {
    const { api, user } = await signedIn();
    const real = api.fetchFn.getMockImplementation()!;
    api.fetchFn.mockImplementation(async (url, init) =>
      new URL(url).pathname === '/api/account'
        ? envelope(500, 'server.internal', true)
        : real(url, init)
    );
    await deleteAndConfirm(user);

    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(notifications).findByText(new RegExp(REQUEST_ID))).toBeVisible();
    expect(screen.getByTestId(ScreenIds.eligibility.roleBadge)).toHaveTextContent('Citizen Voter');
    expect(screen.queryByText('Your account was deleted')).toBeNull();
  });

  it('a session the server no longer knows follows the recovery table: sign in again', async () => {
    const { api, user } = await signedIn();
    // Another device deleted the account: every token of the user, the cookie's too, is gone.
    const real = api.fetchFn.getMockImplementation()!;
    api.fetchFn.mockImplementation(async (url, init) =>
      ['/api/account', '/api/auth/refresh'].includes(new URL(url).pathname)
        ? envelope(401, 'auth.session_expired')
        : real(url, init)
    );
    await deleteAndConfirm(user);

    const dialog = await screen.findByRole('dialog', { name: /session/i });
    expect(api.callsTo('/api/auth/refresh').length).toBeGreaterThanOrEqual(2);
    await user.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByRole('heading', WELCOME)).toBeVisible();
  });
});
