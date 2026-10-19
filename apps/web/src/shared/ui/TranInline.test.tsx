// Verifies: REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranInline } from './TranInline.js';

describe('TranInline', () => {
  it('renders with data-gap and no style attribute', () => {
    render(
      <TranInline data-testid="row" gap="sm">
        a
      </TranInline>
    );
    const el = screen.getByTestId('row');
    expect(el).toHaveAttribute('data-gap', 'sm');
    expect(el).not.toHaveAttribute('style');
  });
});
