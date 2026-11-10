// Verifies: REQ-ERR-010 REQ-ERR-011 REQ-ERR-012
/** How the whole app reacts to the failures added by ADR-0036, against the in-memory API. */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi, envelope, VOTER_SESSION } from '../../tests/helpers/fakeApi.js';
import { App, type AppProps } from './App.js';

const explode = vi.hoisted(() => ({ auditor: false }));

vi.mock('../features/auditor/AuditorPage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../features/auditor/AuditorPage.js')>();
  return {
    AuditorPage: (props: Parameters<typeof real.AuditorPage>[0]) => {
      if (explode.auditor) throw new TypeError('auditor broke');
      return real.AuditorPage(props);
    },
  };
});

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };

/** Answers eligibility with `status` and `code`; health and info as usual. */
async function renderApp(eligibility?: { status: number; code: string }) {
  const api = createFakeApi();
  const real = createFakeApi();
  api.fetchFn.mockImplementation(async (...args: Parameters<typeof real.fetchFn>) => {
    const path = new URL(String(args[0])).pathname;
    if (eligibility && path === '/api/vote/eligibility') {
      return envelope(eligibility.status, eligibility.code);
    }
    return real.fetchFn(...args);
  });
  vi.stubGlobal('fetch', api.fetchFn);
  const user = userEvent.setup();
  render(<App retry={instant} initialSession={VOTER_SESSION} />);
  await screen.findByText(/API (online|offline)/);
  return { api, user };
}

async function askServer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Ask the server/ }));
  await user.clear(screen.getByLabelText('Your age'));
  await user.type(screen.getByLabelText('Your age'), '30');
  await user.click(
    screen.getByRole('button', { name: /Check offline|Check eligibility|Checking/ })
  );
}

beforeEach(() => {
  explode.auditor = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('App: an expired session (REQ-ERR-010)', () => {
  it('asks the user to sign in again; confirming returns to role selection', async () => {
    const { api, user } = await renderApp({ status: 401, code: 'unknown.to.this.build' });
    await askServer(user);

    const dialog = await screen.findByRole('dialog', { name: 'Your session has expired' });
    expect(dialog).toBeVisible();
    // Not retryable: asked once.
    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByRole('button', { name: /Continue as Citizen Voter/ })).toBeVisible();
  });

  it('"Not now" keeps the dashboard and the typed age', async () => {
    const { user } = await renderApp({ status: 401, code: 'auth.session_expired' });
    await askServer(user);
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Your age') as HTMLInputElement).value).toBe('30');
  });
});

describe('App: permission failures (REQ-ERR-010)', () => {
  it('a 403 is a "no permission" toast, never "could not read the request"', async () => {
    const { user } = await renderApp({ status: 403, code: 'auth.forbidden' });
    await askServer(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have permission to do that."
    );
    expect(screen.queryByText(/couldn't read/)).toBeNull();
  });
});

describe('App: toast pressure (REQ-ERR-012)', () => {
  it('the same failure twice shows one toast', async () => {
    const { user } = await renderApp({ status: 403, code: 'auth.forbidden' });
    await askServer(user);
    await screen.findByRole('alert');
    await user.click(
      screen.getByRole('button', { name: /Check offline|Check eligibility|Checking/ })
    );
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('App: crashes (REQ-ERR-011)', () => {
  it('an error nobody caught becomes a long "something went wrong" toast', async () => {
    await renderApp();
    act(() => {
      window.dispatchEvent(
        new ErrorEvent('error', { error: new TypeError('late bug'), cancelable: true })
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong in the app.');
  });

  it('a screen that fails to render is replaced by the crash screen, not a blank page', async () => {
    const { user } = await renderApp();
    explode.auditor = true;
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: /Continue as Election Auditor/ }));
    expect(screen.getByRole('heading', { name: "This screen couldn't be shown" })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});
