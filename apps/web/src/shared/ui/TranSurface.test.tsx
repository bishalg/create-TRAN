// Verifies: REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranSurface } from './TranSurface.js';

describe('TranSurface', () => {
  it('exposes surface, radius, and padding data attributes', () => {
    render(
      <TranSurface data-testid="panel" surface="field" radius="lg" padding="sm">
        x
      </TranSurface>
    );
    const el = screen.getByTestId('panel');
    expect(el).toHaveAttribute('data-surface', 'field');
    expect(el).toHaveAttribute('data-radius', 'lg');
    expect(el).toHaveAttribute('data-padding', 'sm');
    expect(el).not.toHaveAttribute('style');
  });
});
