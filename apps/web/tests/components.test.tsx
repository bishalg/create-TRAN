import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/Field.js';
import { Header } from '../src/components/Header.js';
import { ModeSwitch } from '../src/components/ModeSwitch.js';
import { type EligibilityView, ResultCard } from '../src/components/ResultCard.js';
import { StatusFooter } from '../src/components/StatusFooter.js';
import { initialTheme } from '../src/lib/theme.js';

describe('Field', () => {
  it('ties the label to the input', () => {
    render(<Field label="Age" />);
    expect(screen.getByLabelText('Age')).toBeVisible();
  });

  it('describes the input with its hint', () => {
    render(<Field label="Age" hint="Whole years" />);
    expect(screen.getByLabelText('Age')).toHaveAccessibleDescription('Whole years');
  });

  it('has no description when there is no hint, and forwards input props', () => {
    render(<Field label="Age" maxLength={2} placeholder="p" />);
    const input = screen.getByLabelText('Age');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).toHaveAttribute('maxlength', '2');
  });
});

describe('ModeSwitch', () => {
  it('renders two radios in a named group and reports changes', async () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="device" onChange={onChange} locale="en" />);

    expect(screen.getByRole('group', { name: 'Where should the check run?' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /On this device/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Ask the server/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: /Ask the server/ }));
    expect(onChange).toHaveBeenCalledWith('server');
  });

  it('is localised', () => {
    render(<ModeSwitch mode="server" onChange={() => {}} locale="ne" />);
    expect(screen.getByRole('radio', { name: /सर्भरलाई सोध्नुहोस्/ })).toBeChecked();
  });
});

describe('ResultCard', () => {
  const base: EligibilityView = {
    eligible: true,
    reason: 'Because.',
    countryCode: 'NP',
    minimumAge: 18,
    source: 'device',
  };

  it('shows an eligible verdict with its facts', () => {
    const { container } = render(<ResultCard result={base} locale="en" />);
    expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('Because.')).toBeVisible();
    expect(screen.getByText('NP')).toBeVisible();
    expect(screen.getByText('on this device')).toBeVisible();
    expect(container.querySelector('article')).toHaveAttribute('data-eligible', 'true');
  });

  it('shows an ineligible verdict from the server', () => {
    const { container } = render(
      <ResultCard result={{ ...base, eligible: false, source: 'server' }} locale="en" />
    );
    expect(screen.getByRole('heading', { name: 'Not eligible to vote' })).toBeVisible();
    expect(screen.getByText('by the server')).toBeVisible();
    expect(container.querySelector('article')).toHaveAttribute('data-eligible', 'false');
  });
});

describe('StatusFooter', () => {
  it.each([
    ['checking', 'Checking API…'],
    ['online', 'API online · v1.2.3'],
    ['offline', 'API offline'],
  ] as const)('renders the %s state', (state, text) => {
    const { container } = render(<StatusFooter state={state} version="1.2.3" locale="en" />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(container.querySelector('footer')).toHaveAttribute('data-state', state);
  });

  it('omits the version when the API did not report one', () => {
    render(<StatusFooter state="online" locale="en" />);
    expect(screen.getByRole('status')).toHaveTextContent(/^\s*API online\s*$/);
  });
});

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

describe('initialTheme', () => {
  it('follows the OS preference and defaults to dark', () => {
    expect(initialTheme(() => ({ matches: true }))).toBe('light');
    expect(initialTheme(() => ({ matches: false }))).toBe('dark');
    expect(initialTheme(undefined)).toBe('dark');
  });
});
