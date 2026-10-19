// Verifies: REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranBox } from './TranBox.js';

describe('TranBox', () => {
  it('sets data-padding without inline styles', () => {
    render(
      <TranBox data-testid="box" padding="md">
        x
      </TranBox>
    );
    expect(screen.getByTestId('box')).toHaveAttribute('data-padding', 'md');
    expect(screen.getByTestId('box')).not.toHaveAttribute('style');
  });
});
