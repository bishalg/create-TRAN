// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACTION_CATALOGUE, TranRequestError, type SupportedLocale } from '@tran/core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_COPY, type Feedback, FeedbackProvider, useFeedback } from './FeedbackProvider.js';

function mount(locale: SupportedLocale = 'en') {
  let feedback!: Feedback;
  function Probe() {
    feedback = useFeedback();
    return null;
  }
  render(
    <FeedbackProvider locale={locale}>
      <Probe />
    </FeedbackProvider>
  );
  return () => feedback;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FeedbackProvider: acknowledge', () => {
  it('shows a success toast for 3 seconds, then removes it', () => {
    vi.useFakeTimers();
    const feedback = mount();

    act(() => feedback().acknowledge('server_check_succeeded'));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Server check complete');

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.queryByText('Server check complete')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Server check complete')).toBeNull();
  });

  it('shows nothing for an action whose acknowledgement is not a toast', () => {
    const feedback = mount();
    act(() => feedback().acknowledge('sign_out'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeEmptyDOMElement();
  });
});

describe('FeedbackProvider: report', () => {
  it('logs, shows a long error toast with the reference id, and returns the presentation', () => {
    vi.useFakeTimers();
    const feedback = mount();
    const error = new TranRequestError('server.internal', 'boom', 500, 'req-9');

    let presentation: unknown;
    act(() => {
      presentation = feedback().report(error);
    });

    expect(presentation).toEqual({ kind: 'toast', tone: 'error', duration: 'long' });
    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Something went wrong on our side.');
    expect(toast).toHaveTextContent('Reference: req-9');
    expect(console.error).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ code: 'server.internal', request_id: 'req-9' })
    );

    act(() => vi.advanceTimersByTime(9999));
    expect(screen.queryByRole('alert')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves inline and banner failures to the screen', () => {
    const feedback = mount();
    let kinds: string[] = [];
    act(() => {
      kinds = [
        feedback().report(new TranRequestError('validation.invalid_country_code', 'm')).kind,
        feedback().report(new TranRequestError('network.offline', 'm')).kind,
      ];
    });
    expect(kinds).toEqual(['inline', 'banner']);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeEmptyDOMElement();
  });

  it('can be dismissed early and omits the reference when there is no id', async () => {
    const user = userEvent.setup();
    const feedback = mount();
    act(() => {
      feedback().report(new TranRequestError('server.rate_limited', 'slow down', 429));
    });

    expect(screen.queryByText(/Reference/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Too many requests/)).toBeNull();
  });

  it('speaks the active language', () => {
    const feedback = mount('ne');
    act(() => feedback().acknowledge('server_check_succeeded'));
    expect(screen.getByRole('region', { name: 'सूचनाहरू' })).not.toBeEmptyDOMElement();
  });
});

describe('FeedbackProvider: confirm', () => {
  it('asks before a destructive action and resolves true on confirm', async () => {
    const user = userEvent.setup();
    const feedback = mount();

    let answer: Promise<boolean>;
    act(() => {
      answer = feedback().confirm('sign_out');
    });

    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(dialog).toHaveTextContent("You'll return to role selection.");
    // Destructive: the safe choice has focus.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const user = userEvent.setup();
    const feedback = mount();
    let answer: Promise<boolean>;
    act(() => {
      answer = feedback().confirm('sign_out');
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer!).resolves.toBe(false);
  });

  it('resolves immediately when the catalogue asks for no dialog', async () => {
    const feedback = mount();
    await expect(feedback().confirm('server_check_succeeded')).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has copy for every action the catalogue presents as a dialog', () => {
    for (const spec of ACTION_CATALOGUE) {
      if (spec.presentation.kind === 'dialog') expect(DIALOG_COPY[spec.action]).not.toBeNull();
    }
  });
});

describe('useFeedback', () => {
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useFeedback())).toThrow(/inside <FeedbackProvider>/);
  });

  it('is available to any descendant', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeedbackProvider locale="en">{children}</FeedbackProvider>
    );
    const { result } = renderHook(() => useFeedback(), { wrapper });
    expect(typeof result.current.report).toBe('function');
  });
});
