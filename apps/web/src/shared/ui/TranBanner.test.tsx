// Verifies: REQ-ERR-006
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranBanner } from './TranBanner.js';

describe('TranBanner', () => {
  it('is a persistent status message with a warning tone by default', () => {
    render(<TranBanner className="notice">API unreachable</TranBanner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('API unreachable');
    expect(banner).toHaveAttribute('data-tone', 'warning');
    expect(banner).toHaveClass('tran-banner', 'notice');
  });

  it('supports an info tone', () => {
    render(<TranBanner tone="info">FYI</TranBanner>);
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
  });
});
