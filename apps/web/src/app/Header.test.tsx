import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenIds } from '@tran/core';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';

describe('Header', () => {
  it('marks the current locale, reports changes and marks the current theme', async () => {
    const onLocaleChange = vi.fn();
    const onThemeChange = vi.fn();
    render(
      <Header
        locale="hi"
        onLocaleChange={onLocaleChange}
        theme="dark"
        onThemeChange={onThemeChange}
      />
    );

    expect(screen.getByRole('button', { name: 'HI' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(onLocaleChange).toHaveBeenCalledWith('en');

    const themes = screen.getByRole('group', { name: 'थीम' });
    expect(within(themes).getByRole('button', { name: 'डार्क' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(within(themes).getByRole('button', { name: 'सेपिया' }));
    expect(onThemeChange).toHaveBeenCalledWith('sepia');
  });

  // Verifies: REQ-SCR-008 — the contract offers the theme picker on the voter dashboard only.
  it('offers no theme picker when the screen has none', () => {
    render(<Header locale="en" onLocaleChange={() => {}} theme="light" />);
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Language' })).toBeVisible();
  });

  it('renders one choice per generated theme, in registry order', () => {
    render(<Header locale="en" onLocaleChange={() => {}} theme="light" onThemeChange={() => {}} />);
    const themes = screen.getByRole('group', { name: 'Theme' });
    expect(
      within(themes)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Light', 'Dark', 'Black', 'Sepia']);
    // A scenario's `select` addresses an option by its registry name (ADR-0038).
    expect(
      within(themes)
        .getAllByRole('button')
        .map((button) => button.getAttribute('value'))
    ).toEqual(['light', 'dark', 'black', 'sepia']);
    expect(within(themes).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  // Verifies: REQ-ACC-004 — the control sits next to sign-out and looks destructive.
  it('offers deleting the account next to sign-out when the screen allows it', async () => {
    const onDeleteAccount = vi.fn();
    render(
      <Header
        locale="en"
        onLocaleChange={() => {}}
        theme="light"
        currentRole="citizen_voter"
        onSignOut={() => {}}
        onDeleteAccount={onDeleteAccount}
      />
    );
    const control = screen.getByTestId(ScreenIds.eligibility.deleteAccountButton);
    expect(control).toHaveAccessibleName('Delete account');
    expect(control).toHaveAttribute('data-variant', 'danger');
    expect(control.previousElementSibling).toBe(
      screen.getByTestId(ScreenIds.eligibility.signOutButton)
    );
    await userEvent.click(control);
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it('offers no deletion while signed out', () => {
    render(<Header locale="en" onLocaleChange={() => {}} theme="light" />);
    expect(screen.queryByTestId(ScreenIds.eligibility.deleteAccountButton)).toBeNull();
  });
});
