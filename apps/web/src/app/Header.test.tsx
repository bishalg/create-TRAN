import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';

describe('Header', () => {
  it('marks the current locale, reports changes and labels the theme action', async () => {
    const onLocaleChange = vi.fn();
    const onThemeToggle = vi.fn();
    render(
      <Header
        locale="hi"
        onLocaleChange={onLocaleChange}
        theme="dark"
        onThemeToggle={onThemeToggle}
      />
    );

    expect(screen.getByRole('button', { name: 'HI' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(onLocaleChange).toHaveBeenCalledWith('en');

    await userEvent.click(screen.getByRole('button', { name: 'लाइट थीम पर जाएँ' }));
    expect(onThemeToggle).toHaveBeenCalledOnce();
  });

  it('offers the dark theme when the page is light', () => {
    render(<Header locale="en" onLocaleChange={() => {}} theme="light" onThemeToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  });
});
