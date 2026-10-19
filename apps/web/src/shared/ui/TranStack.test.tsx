// Verifies: REQ-WEB-010, REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranStack } from './TranStack.js';

describe('TranStack', () => {
  it('uses data-gap for token spacing without inline style', () => {
    render(
      <TranStack data-testid="stack" gap="md">
        child
      </TranStack>
    );
    const el = screen.getByTestId('stack');
    expect(el).toHaveAttribute('data-gap', 'md');
    expect(el).not.toHaveAttribute('style');
    expect(el).toHaveClass('tran-stack');
  });

  it('merges className and forwards props', () => {
    render(
      <TranStack className="extra" gap="lg">
        x
      </TranStack>
    );
    expect(screen.getByText('x')).toHaveClass('tran-stack', 'extra');
  });
});
