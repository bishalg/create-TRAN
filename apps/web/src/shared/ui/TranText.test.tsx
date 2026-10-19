// Verifies: REQ-WEB-009
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranText } from './TranText.js';

describe('TranText', () => {
  it('renders body as a paragraph with the body variant token class', () => {
    render(<TranText variant="body">Hello</TranText>);
    const el = screen.getByText('Hello');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('tran-text');
    expect(el).toHaveAttribute('data-variant', 'body');
  });

  it('renders title as h2 by default and h1 when as is set', () => {
    const { rerender } = render(<TranText variant="title">Heading</TranText>);
    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeVisible();

    rerender(
      <TranText variant="title" as="h1">
        Hero
      </TranText>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hero' })).toBeVisible();
  });

  it('maps semantic color variants to data-variant for CSS token hooks', () => {
    render(
      <>
        <TranText variant="muted">Muted</TranText>
        <TranText variant="success">OK</TranText>
        <TranText variant="danger">Bad</TranText>
      </>
    );
    expect(screen.getByText('Muted')).toHaveAttribute('data-variant', 'muted');
    expect(screen.getByText('OK')).toHaveAttribute('data-variant', 'success');
    expect(screen.getByText('Bad')).toHaveAttribute('data-variant', 'danger');
  });

  it('renders caption as span for inline chip text', () => {
    render(<TranText variant="caption">Fine print</TranText>);
    expect(screen.getByText('Fine print').tagName).toBe('SPAN');
  });

  it('renders display as h1 by default and never sets inline style', () => {
    render(<TranText variant="display">Hero</TranText>);
    const el = screen.getByRole('heading', { level: 1, name: 'Hero' });
    expect(el).toHaveAttribute('data-variant', 'display');
    expect(el).not.toHaveAttribute('style');
  });
});
