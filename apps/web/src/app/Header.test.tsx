import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders one choice per generated theme, in registry order', () => {
    render(<Header locale="en" onLocaleChange={() => {}} theme="light" onThemeChange={() => {}} />);
    const themes = screen.getByRole('group', { name: 'Theme' });
    expect(
      within(themes)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Light', 'Dark', 'Black', 'Sepia']);
    expect(within(themes).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
