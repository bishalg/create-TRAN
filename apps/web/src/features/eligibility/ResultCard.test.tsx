// Verifies: REQ-WEB-005
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type EligibilityView, ResultCard } from './ResultCard.js';

const view: EligibilityView = {
  eligible: true,
  reason: 'Because.',
  countryCode: 'NP',
  minimumAge: 18,
  source: 'device',
};

describe('ResultCard', () => {
  it('shows an eligible verdict with its facts', () => {
    const { container } = render(<ResultCard result={view} locale="en" />);

    expect(screen.getByRole('heading', { name: 'Eligible to vote' })).toBeVisible();
    expect(screen.getByText('Because.')).toBeVisible();
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
});
