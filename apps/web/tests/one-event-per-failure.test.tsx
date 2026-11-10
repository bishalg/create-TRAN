// Verifies: REQ-ROB-007 (web half) — one `request failed` event per failure, and one reporter
// event for an error-level one, on every session path.
/**
 * The rule that keeps it single: the session client (`packages/api`) never logs; it returns or
 * throws the failure, and whoever handles it logs it once, either `logFailure` for a call the
 * user did not start or `feedback.report` (which logs) for one they did. Each case below fails
 * one request only, lets everything else answer, and counts what was emitted after the action.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LOG_EVENT,
  ScreenIds,
  setErrorReporter,
  type ErrorCode,
  type ReportEvent,
} from '@tran/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from '../src/app/App.js';
import { createFakeApi, envelope, type FakeApiOptions } from './helpers/fakeApi.js';

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

let spies: ReturnType<typeof vi.spyOn>[];
let reported: ReportEvent[];

beforeEach(() => {
  reported = [];
  setErrorReporter((event) => reported.push(event));
  spies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

/** Every `request failed` event so far, as `level code`. */
const events = () =>
  spies.flatMap((spy, index) =>
    (spy.mock.calls as unknown[][])
      .filter(([message]) => message === LOG_EVENT.message)
      .map(([, fields]) => `${LEVELS[index]} ${(fields as { code: ErrorCode }).code}`)
  );

/** Forgets what was emitted so far (the boot), so a case counts only its own failure. */
function resetCounts() {
  for (const spy of spies) spy.mockClear();
  reported = [];
}

type Failure = () => Promise<unknown>;
const offline: Failure = async () => {
  throw new TypeError('Failed to fetch');
};

/**
 * The fake API, with `path` (and `method`, when given) answered by `fail` instead. Every other
 * request answers normally, so nothing else emits an event.
 */
function boot(
  options: FakeApiOptions,
  fail?: { path: string; method?: string; with: Failure; after?: number }
) {
  const api = createFakeApi(options);
  const real = api.fetchFn.getMockImplementation()!;
  let seen = 0;
  api.fetchFn.mockImplementation(async (url, init) => {
    const matches =
      fail &&
      new URL(url).pathname === fail.path &&
      (fail.method === undefined || (init?.method ?? 'GET') === fail.method);
    if (matches && ++seen > (fail.after ?? 0)) return (await fail.with()) as never;
    return real(url, init);
  });
  vi.stubGlobal('fetch', api.fetchFn);
  render(<App retry={instant} />);
  return { api, user: userEvent.setup() };
}

/** The boot has settled: the API status answered and the dashboard or Auth Welcome is up. */
async function settled() {
  await waitFor(() =>
    expect(document.querySelector('footer')?.getAttribute('data-state')).toMatch(/online/)
  );
}

async function signedInAndQuiet(options: FakeApiOptions, fail: Parameters<typeof boot>[1]) {
  const booted = boot(options, fail);
  await screen.findByTestId(ScreenIds.eligibility.roleBadge);
  await settled();
  await waitFor(() => expect(booted.api.callsTo('/api/auth/session')).toHaveLength(1));
  resetCounts();
  return booted;
}

async function confirmDeletion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton));
  await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountConfirm));
}

describe('one event per failure (REQ-ROB-007)', () => {
  it('(a) a deletion the server fails with 500: one error event, one report', async () => {
    const { user } = await signedInAndQuiet(
      { cookie: 'citizen_voter' },
      {
        path: '/api/account',
        with: async () => envelope(500, 'server.internal', true),
      }
    );
    await confirmDeletion(user);
    await screen.findByText(/Reference/);
    expect(events()).toEqual(['error server.internal']);
    expect(reported.map((event) => event.code)).toEqual(['server.internal']);
  });

  it('(a) a deletion that cannot reach the server: one info event, no report', async () => {
    const { user } = await signedInAndQuiet(
      { cookie: 'citizen_voter' },
      { path: '/api/account', with: offline }
    );
    await confirmDeletion(user);
    await screen.findByTestId(ScreenIds.eligibility.offlineNotice);
    expect(events()).toEqual(['info network.offline']);
    expect(reported).toEqual([]);
  });

  it('(b) the background sign-in after choosing a role fails: one event', async () => {
    const { api, user } = boot(
      {},
      {
        path: '/api/auth/session',
        method: 'POST',
        with: async () => envelope(500, 'server.internal'),
      }
    );
    await user.click(await screen.findByTestId(ScreenIds.authWelcome.voterBranchButton));
    await settled();
    await waitFor(() => expect(api.callsTo('/api/auth/session')).toHaveLength(1));
    await waitFor(() => expect(events()).toContain('error server.internal'));
    // The boot's first-visit refresh (no cookie) is the normal case and logs nothing.
    expect(events()).toEqual(['error server.internal']);
    expect(reported.map((event) => event.code)).toEqual(['server.internal']);
  });

  it('(c) the boot refresh cannot reach the API: one event', async () => {
    boot({ cookie: 'citizen_voter' }, { path: '/api/auth/refresh', with: offline });
    await screen.findByTestId(ScreenIds.authWelcome.voterBranchButton);
    await settled();
    expect(events()).toEqual(['info network.offline']);
    expect(reported).toEqual([]);
  });

  it('(d) a restored session ends in a rejected refresh: one event, and the dialog', async () => {
    const api = createFakeApi({ cookie: 'citizen_voter' });
    const real = api.fetchFn.getMockImplementation()!;
    let refreshes = 0;
    api.fetchFn.mockImplementation(async (url, init) => {
      const path = new URL(url).pathname;
      const whoAmI = path === '/api/auth/session' && init?.method !== 'POST';
      if (whoAmI || (path === '/api/auth/refresh' && ++refreshes > 1))
        return envelope(401, 'auth.session_expired') as never;
      return real(url, init);
    });
    vi.stubGlobal('fetch', api.fetchFn);
    render(<App retry={instant} />);

    await screen.findByRole('dialog');
    await settled();
    expect(events()).toEqual(['info auth.session_expired']);
    expect(reported).toEqual([]);
  });

  it('(e) sign-out whose server call fails: one event', async () => {
    const { user } = await signedInAndQuiet(
      { cookie: 'citizen_voter' },
      { path: '/api/auth/sign-out', with: async () => envelope(500, 'server.internal') }
    );
    await user.click(screen.getByTestId(ScreenIds.eligibility.signOutButton));
    await user.click(screen.getByTestId(ScreenIds.eligibility.dialogConfirm));
    await screen.findByTestId(ScreenIds.authWelcome.voterBranchButton);
    await waitFor(() => expect(events()).toContain('error server.internal'));
    expect(events()).toEqual(['error server.internal']);
    expect(reported.map((event) => event.code)).toEqual(['server.internal']);
  });
});
