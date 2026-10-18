import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { createFakeApi } from './helpers/fakeApi.js';

async function renderApp(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  const user = userEvent.setup();
  render(<App />);
  // Startup settles either as healthy or as the offline banner.
  await screen.findByText(/HEALTHY|API unreachable/);
  return { api, user };
}

const offlineCard = () =>
  screen.getByRole('region', { name: /offline \(rust rules mirror\)/i });
const apiCard = () => screen.getByRole('region', { name: /api \(country from ip stub\)/i });

async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input);
  if (value) await user.type(input, value);
}

describe('App: shell', () => {
  it('renders the title and subtitle in English by default', async () => {
    await renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
  });

  it('shows the health of every stack component once the API answers', async () => {
    await renderApp();
    expect(await screen.findByText(/HEALTHY/)).toBeVisible();
    expect(screen.getByText('Rust Domain Core')).toBeVisible();
    expect(screen.getByText('Axum Microservice')).toBeVisible();
  });

  it('switches language and back', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'NE' }));
    expect(screen.getByRole('heading', { level: 1, name: 'मतदान योग्यता' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Voting Eligibility' })).toBeVisible();
  });

  it('toggles the theme on <html data-theme>', async () => {
    const { user } = await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('App: offline check', () => {
  it('declares an adult eligible without any network call', async () => {
    const { api, user } = await renderApp();
    await screen.findByText(/HEALTHY/);
    const before = api.fetchFn.mock.calls.length;
    const card = within(offlineCard());

    await fill(user, card.getByLabelText('Age (years)'), '20');
    await fill(user, card.getByLabelText('Country (offline)'), 'NP');
    await user.click(card.getByRole('button', { name: 'Check offline' }));

    expect(card.getByText('Eligible to vote')).toBeVisible();
    expect(card.getByText('Age 20 meets the minimum voting age of 18 in NP.')).toBeVisible();
    expect(api.fetchFn.mock.calls.length).toBe(before);
  });

  it('declares a minor not eligible', async () => {
    const { user } = await renderApp();
    const card = within(offlineCard());
    await fill(user, card.getByLabelText('Age (years)'), '17');
    await user.click(card.getByRole('button', { name: 'Check offline' }));

    expect(card.getByText('Not eligible to vote')).toBeVisible();
  });

  it('applies the Brazilian voting age of 16', async () => {
    const { user } = await renderApp();
    const card = within(offlineCard());
    await fill(user, card.getByLabelText('Age (years)'), '16');
    await fill(user, card.getByLabelText('Country (offline)'), 'br');
    await user.click(card.getByRole('button', { name: 'Check offline' }));

    expect(card.getByText('Eligible to vote')).toBeVisible();
    expect(card.getByText(/BR · min age 16/)).toBeVisible();
  });

  it.each([['', 'empty'], ['abc', 'non-numeric'], ['-3', 'negative'], ['200', 'too old'], ['21.5', 'fractional']])(
    'shows a visible error for an invalid age (%j: %s)',
    async (value) => {
      const { user } = await renderApp();
      const card = within(offlineCard());
      await fill(user, card.getByLabelText('Age (years)'), value);
      await user.click(card.getByRole('button', { name: 'Check offline' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(card.queryByText(/to vote/)).toBeNull();
    }
  );

  it('shows a visible error for a malformed country code', async () => {
    const { user } = await renderApp();
    const card = within(offlineCard());
    await fill(user, card.getByLabelText('Country (offline)'), 'USA');
    await user.click(card.getByRole('button', { name: 'Check offline' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/country code/i);
  });
});

describe('App: API check', () => {
  it('sends the debug country and renders the server verdict', async () => {
    const { api, user } = await renderApp();
    const card = within(apiCard());

    await fill(user, card.getByLabelText('Age (years)'), '16');
    await fill(user, card.getByLabelText('Debug country (API header)'), 'BR');
    await user.click(card.getByRole('button', { name: 'Check via API' }));

    expect(await card.findByText('Eligible to vote')).toBeVisible();
    const [call] = api.callsTo('/api/vote/eligibility');
    expect((call[1]?.headers as Record<string, string>)['X-Debug-Country']).toBe('BR');
    expect(card.getByText(/IP 127\.0\.0\.1/)).toBeVisible();
  });

  it('shows the server validation message without claiming the API is offline', async () => {
    const { user } = await renderApp();
    const card = within(apiCard());
    await fill(user, card.getByLabelText('Debug country (API header)'), 'USA');
    await user.click(card.getByRole('button', { name: 'Check via API' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/country code/i);
    expect(screen.queryByText(/API unreachable/)).toBeNull();
  });
});

describe('App: server down', () => {
  it('shows the offline banner but keeps offline checks working', async () => {
    const { user } = await renderApp({ down: true });
    expect(await screen.findByText(/API unreachable/)).toBeVisible();

    const card = within(offlineCard());
    await user.click(card.getByRole('button', { name: 'Check offline' }));
    expect(card.getByText('Eligible to vote')).toBeVisible();
  });
});
