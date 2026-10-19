// Verifies: REQ-WEB-009
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranStack } from './TranStack.js';

describe('TranStack', () => {
  it('renders a vertical flex stack with default gap token and tran-stack class', () => {
    render(<TranStack data-testid="stack">Child</TranStack>);
    const el = screen.getByTestId('stack');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('tran-stack');
    expect(el).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
    });
    expect(screen.getByText('Child')).toBeVisible();
  });

  it('maps gap variants to spacing CSS variables', () => {
    const { rerender } = render(
      <TranStack data-testid="stack" gap="sm">
        A
      </TranStack>
    );
    expect(screen.getByTestId('stack')).toHaveStyle({ gap: 'var(--tran-spacing-sm)' });

    rerender(
      <TranStack data-testid="stack" gap="md">
        B
      </TranStack>
    );
    expect(screen.getByTestId('stack')).toHaveStyle({ gap: 'var(--tran-spacing-md)' });

    rerender(
      <TranStack data-testid="stack" gap="5">
        C
      </TranStack>
    );
    expect(screen.getByTestId('stack')).toHaveStyle({ gap: 'var(--space-5)' });
  });

  it('merges optional className and inline style with stack defaults', () => {
    render(
      <TranStack data-testid="stack" className="extra" style={{ marginTop: '1rem' }}>
        Nested
      </TranStack>
    );
    const el = screen.getByTestId('stack');
    expect(el).toHaveClass('tran-stack', 'extra');
    expect(el).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      marginTop: '1rem',
    });
  });
});
