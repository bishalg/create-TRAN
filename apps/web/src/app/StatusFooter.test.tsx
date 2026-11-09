import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusFooter } from './StatusFooter.js';

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

  // Verifies: REQ-SCR-008 — the contract offers the API status on the voter dashboard only.
  it('keeps the footer landmark but no status when the screen offers none', () => {
    const { container } = render(<StatusFooter state="online" locale="en" showStatus={false} />);
    expect(container.querySelector('footer')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('omits the version when the API did not report one', () => {
    render(<StatusFooter state="online" locale="en" />);
    expect(screen.getByRole('status')).toHaveTextContent(/^\s*API online\s*$/);
  });
});
