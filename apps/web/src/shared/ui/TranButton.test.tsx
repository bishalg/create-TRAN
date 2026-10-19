// Verifies: REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { TranButton } from './TranButton.js';

describe('TranButton', () => {
  it('defaults to primary lg and forwards ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <TranButton ref={ref} type="button">
        Go
      </TranButton>
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(ref.current).toBe(btn);
    expect(btn).toHaveAttribute('data-variant', 'primary');
    expect(btn).toHaveAttribute('data-size', 'lg');
    expect(btn).not.toHaveAttribute('style');
  });

  it('supports secondary variant', () => {
    render(
      <TranButton variant="secondary" size="md">
        Alt
      </TranButton>
    );
    const btn = screen.getByRole('button', { name: 'Alt' });
    expect(btn).toHaveAttribute('data-variant', 'secondary');
    expect(btn).toHaveAttribute('data-size', 'md');
  });
});
