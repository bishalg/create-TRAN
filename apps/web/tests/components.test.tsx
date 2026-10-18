import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GlassCard } from '../src/components/ui/GlassCard.js';
import { GlassInput } from '../src/components/ui/GlassInput.js';
import { SkeletonView } from '../src/components/ui/SkeletonView.js';

describe('GlassCard', () => {
  it('renders children as a landmark named by its heading', () => {
    render(
      <GlassCard labelledBy="h">
        <h2 id="h">Title</h2>
      </GlassCard>
    );
    expect(screen.getByRole('region', { name: 'Title' })).toBeVisible();
  });

  it('is clickable only when onClick is given', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<GlassCard onClick={onClick}>body</GlassCard>);
    await userEvent.click(screen.getByText('body'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('body')).toHaveStyle({ cursor: 'pointer' });

    rerender(
      <GlassCard className="x" style={{ margin: 3 }}>
        body
      </GlassCard>
    );
    expect(screen.getByText('body')).toHaveStyle({ cursor: 'default' });
    expect(screen.getByText('body')).toHaveClass('glass-card', 'x');
  });
});

describe('GlassInput', () => {
  it('associates the label with the input', () => {
    render(<GlassInput label="Age" />);
    expect(screen.getByLabelText('Age')).toBeVisible();
  });

  it('works without a label and honours a caller-supplied id', () => {
    render(<GlassInput id="mine" placeholder="p" />);
    expect(screen.getByPlaceholderText('p')).toHaveAttribute('id', 'mine');
  });

  it('flags and describes an error accessibly', () => {
    render(<GlassInput label="Age" error="Too old" className="c" style={{ width: 10 }} />);
    const input = screen.getByLabelText('Age');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Too old');
  });

  it('has no error attributes when valid', () => {
    render(<GlassInput label="Age" />);
    expect(screen.getByLabelText('Age')).not.toHaveAttribute('aria-invalid');
  });
});

describe('SkeletonView', () => {
  it('renders one block by default and N blocks when counted', () => {
    const { container, rerender } = render(<SkeletonView />);
    expect(container.querySelectorAll('.skeleton-pulse')).toHaveLength(1);
    rerender(
      <SkeletonView count={3} height={10} width={50} borderRadius="2px" style={{ opacity: 1 }} />
    );
    expect(container.querySelectorAll('.skeleton-pulse')).toHaveLength(3);
  });
});
