// Verifies: REQ-ERR-006 REQ-ERR-008
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranToast, TranToastRegion } from './TranToast.js';

describe('TranToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderToast = (props: Partial<Parameters<typeof TranToast>[0]> = {}) => {
    const onDismiss = vi.fn();
    render(
      <TranToastRegion label="Notifications">
        <TranToast
          tone="success"
          message="Server check complete"
          durationMs={3000}
          dismissLabel="Dismiss"
          onDismiss={onDismiss}
          {...props}
        />
      </TranToastRegion>
    );
    return onDismiss;
  };

  it('announces success politely inside a labelled region and dismisses itself on time', () => {
    const onDismiss = renderToast();
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(
      screen.getByRole('status')
    );
    expect(screen.getByRole('status')).toHaveTextContent('Server check complete');

    act(() => vi.advanceTimersByTime(2999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses role=alert for errors and shows the reference line', () => {
    renderToast({ tone: 'error', message: 'Something went wrong', detail: 'Reference: r-1' });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: r-1');
  });

  it('pauses while hovered or focused and resumes with the time that was left', () => {
    const onDismiss = renderToast({ tone: 'warning', durationMs: 5000 });
    const toast = screen.getByRole('status');

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(999));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.focus(toast);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(toast);
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed with its labelled button', () => {
    const onDismiss = renderToast({ tone: 'info' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
