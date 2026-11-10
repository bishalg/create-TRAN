// Verifies: REQ-VER-004 REQ-VER-009 REQ-VER-010
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLIENT_HEADER, RECOMMENDED_VERSION_HEADER, ScreenIds, UPDATE_HEADER } from '@tran/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi, envelope, VOTER_SESSION } from '../../tests/helpers/fakeApi.js';
import { UPDATE_PROMPT_STORAGE_KEY } from '../shared/lib/updatePrompt.js';
import { App, type AppProps } from './App.js';

const instant: AppProps['retry'] = { sleep: async () => {}, random: () => 0 };
/** The version `pnpm release` writes, read from the web's own `package.json`. */
const VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
).version;

type Answer = Awaited<ReturnType<ReturnType<typeof createFakeApi>['fetchFn']>>;

/** The fake API, with `edit` changing every answer (a header, or a 426 instead). */
function serve(edit: (path: string, answer: Answer) => Answer = (_, answer) => answer) {
  const api = createFakeApi();
  const real = createFakeApi();
  api.fetchFn.mockImplementation(async (url: string, init?: RequestInit) =>
    edit(new URL(url).pathname, await real.fetchFn(url, init))
  );
  vi.stubGlobal('fetch', api.fetchFn);
  return api;
}

/** Every answer nudges toward `version` (or names no version). */
const nudge = (version: string | null) => (_: string, answer: Answer) => {
  answer.headers.set(UPDATE_HEADER, 'recommended');
  if (version) answer.headers.set(RECOMMENDED_VERSION_HEADER, version);
  return answer;
};

afterEach(() => localStorage.clear());

describe('App: the client names itself (REQ-VER-004)', () => {
  it('sends X-Tran-Client: web/<the release version> on every request', async () => {
    const api = serve();
    render(<App retry={instant} initialSession={VOTER_SESSION} />);
    await screen.findByText(/API online/);
    expect(api.fetchFn.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of api.fetchFn.mock.calls) {
      expect((init?.headers as Record<string, string>)[CLIENT_HEADER]).toBe(`web/${VERSION}`);
    }
  });
});

describe('App: an unsupported version must update (REQ-VER-009)', () => {
  it('replaces everything with the update screen, keeps the session, and reloads on Update', async () => {
    const reload = vi.fn();
    const api = serve((path, answer) =>
      path === '/api/v1/account' ? envelope(426, 'client.upgrade_required') : answer
    );
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={VOTER_SESSION} reload={reload} />);
    await screen.findByText(/API online/);
    await user.click(screen.getByTestId(ScreenIds.eligibility.deleteAccountButton));
    await user.click(await screen.findByTestId(ScreenIds.eligibility.deleteAccountConfirm));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Update required' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('no longer supported');
    expect(screen.queryByTestId(ScreenIds.eligibility.checkButton)).toBeNull();
    expect(screen.queryByTestId(ScreenIds.authWelcome.voterBranchButton)).toBeNull();
    expect(screen.queryByRole('status', { name: /notifications/i })).toBeNull();
    expect(api.callsTo('/api/v1/auth/sign-out')).toHaveLength(0);

    await user.click(screen.getByTestId(ScreenIds.eligibility.updateButton));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('stays blocked when a later answer only nudges, and reloads the page by default', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    let blocked = false;
    serve((path, answer) => {
      if (path === '/api/v1/tran/info') {
        blocked = true;
        return envelope(426, 'client.upgrade_required');
      }
      return blocked ? nudge('9.0.0')(path, answer) : answer;
    });
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={VOTER_SESSION} />);
    const update = await screen.findByTestId(ScreenIds.eligibility.updateButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(update);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('App: a recommended update is offered once per version (REQ-VER-010)', () => {
  it('asks once; Not now is remembered for that version and the app goes on', async () => {
    const api = serve(nudge('2.0.0'));
    const user = userEvent.setup();
    const { unmount } = render(<App retry={instant} initialSession={VOTER_SESSION} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('A new version is available')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(localStorage.getItem(UPDATE_PROMPT_STORAGE_KEY)).toBe('2.0.0'));
    expect(screen.getByTestId(ScreenIds.eligibility.checkButton)).toBeVisible();
    unmount();

    // The next visit, still nudged toward 2.0.0: nothing to ask.
    render(<App retry={instant} initialSession={VOTER_SESSION} />);
    await screen.findByText(/API online/);
    expect(api.fetchFn).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks again for a newer recommended version, and Update reloads', async () => {
    localStorage.setItem(UPDATE_PROMPT_STORAGE_KEY, '2.0.0');
    const reload = vi.fn();
    serve(nudge('2.1.0'));
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={VOTER_SESSION} reload={reload} />);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem(UPDATE_PROMPT_STORAGE_KEY)).toBe('2.0.0');
  });

  it('remembers a dismissal even when the server names no version', async () => {
    serve(nudge(null));
    const user = userEvent.setup();
    render(<App retry={instant} initialSession={VOTER_SESSION} />);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(localStorage.getItem(UPDATE_PROMPT_STORAGE_KEY)).toBe(''));
  });
});
