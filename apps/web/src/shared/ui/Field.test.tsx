import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field.js';

describe('Field', () => {
  it('ties the label to the input', () => {
    render(<Field label="Age" />);
    expect(screen.getByLabelText('Age')).toBeVisible();
  });

  it('describes the input with its hint', () => {
    render(<Field label="Age" hint="Whole years" />);
    expect(screen.getByLabelText('Age')).toHaveAccessibleDescription('Whole years');
  });

  it('has no description without a hint, and forwards input props', () => {
    render(<Field label="Age" maxLength={2} />);
    const input = screen.getByLabelText('Age');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).toHaveAttribute('maxlength', '2');
  });

  it('forwards a ref to the input so callers can manage focus', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Field ref={ref} label="Age" />);
    expect(ref.current).toBe(screen.getByLabelText('Age'));
  });
});
