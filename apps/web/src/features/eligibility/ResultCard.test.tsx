// Verifies: REQ-WEB-005, REQ-I18N-007
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type EligibilityView, ResultCard } from './ResultCard.js';

const view: EligibilityView = {
  eligible: true,
  age: 20,
  countryCode: 'NP',
  minimumAge: 18,
  source: 'device',
};

describe('ResultCard', () => {
  it('shows an eligible verdict with its facts', () => {
    const { container } = render(<ResultCard result={view} locale="en" />);

    expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('Age 20 meets the minimum voting age of 18 in NP.')).toBeVisible();
    expect(screen.getByText('NP')).toBeVisible();
    expect(screen.getByText('Checked on this device')).toBeVisible();
    expect(container.querySelector('article')).toHaveAttribute('data-eligible', 'true');
  });

  it('shows an ineligible verdict from the server', () => {
    const { container } = render(
      <ResultCard result={{ ...view, eligible: false, source: 'server' }} locale="en" />
    );

    expect(screen.getByRole('heading', { name: 'Not eligible to vote' })).toBeVisible();
    expect(screen.getByText('Checked by the server')).toBeVisible();
    expect(container.querySelector('article')).toHaveAttribute('data-eligible', 'false');
  });

  it('words the reason from the facts, not from English text', () => {
    render(<ResultCard result={{ ...view, eligible: false, age: 17 }} locale="en" />);

    expect(screen.getByText('Age 17 is below the minimum voting age of 18 in NP.')).toBeVisible();
  });

  it.each([
    ['ne', 'उमेर 20 ले न्यूनतम मतदान उमेर 18 पूरा गर्छ (NP)।'],
    ['hi', 'आयु 20 न्यूनतम मतदान आयु 18 को पूरा करती है (NP)।'],
  ] as const)('localizes the reason sentence in %s', (locale, sentence) => {
    render(<ResultCard result={view} locale={locale} />);

    expect(screen.getByText(sentence)).toBeVisible();
  });
});
