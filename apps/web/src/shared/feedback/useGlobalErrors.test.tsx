// Verifies: REQ-ERR-011
import { renderHook } from '@testing-library/react';
import { type Presentation, type TranRequestError } from '@tran/core';
import { describe, expect, it, vi } from 'vitest';
import type { Feedback } from './FeedbackProvider.js';
import { useGlobalErrors } from './useGlobalErrors.js';

function fakeFeedback() {
  const report = vi.fn<(error: TranRequestError) => Presentation>(() => ({ kind: 'silent' }));
  const feedback: Feedback = {
    acknowledge: vi.fn(),
    confirm: vi.fn(),
    report,
    onErrorConfirmed: vi.fn(() => () => {}),
  };
  return { feedback, report };
}

function rejection(reason: unknown): Event {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.assign(event, { reason });
  return event;
}

describe('useGlobalErrors (REQ-ERR-011)', () => {
  it('reports an uncaught error as client.unexpected and keeps it out of the console', () => {
    const { feedback, report } = fakeFeedback();
    renderHook(() => useGlobalErrors(feedback));
    const event = new ErrorEvent('error', { error: new TypeError('boom'), cancelable: true });
    window.dispatchEvent(event);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![0]).toMatchObject({ code: 'client.unexpected', message: 'boom' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('reports an unhandled rejection through the same classification', () => {
    const { feedback, report } = fakeFeedback();
    renderHook(() => useGlobalErrors(feedback));
    window.dispatchEvent(rejection(new DOMException('gone', 'NetworkError')));
    window.dispatchEvent(rejection('a string'));
    expect(report.mock.calls.map(([error]) => error.code)).toEqual([
      'network.offline',
      'client.unexpected',
    ]);
  });

  it('falls back to the event message when there is no error object (cross-origin script)', () => {
    const { feedback, report } = fakeFeedback();
    renderHook(() => useGlobalErrors(feedback));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    expect(report.mock.calls[0]![0]).toMatchObject({
      code: 'client.unexpected',
      message: 'Script error.',
    });
  });

  it('stops listening on unmount', () => {
    const { feedback, report } = fakeFeedback();
    const { unmount } = renderHook(() => useGlobalErrors(feedback));
    unmount();
    // Nothing handles it now, so jsdom would print it; swallow it for a quiet run.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener('error', swallow);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('late'), cancelable: true }));
    window.removeEventListener('error', swallow);
    expect(report).not.toHaveBeenCalled();
  });
});
