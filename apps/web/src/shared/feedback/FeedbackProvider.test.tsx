// Verifies: REQ-ERR-006 REQ-ERR-007 REQ-ERR-008 REQ-ERR-010 REQ-ERR-012
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ACTION_CATALOGUE,
  ERROR_CATALOGUE,
  TranRequestError,
  type SupportedLocale,
} from '@tran/core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIALOG_COPY,
  ERROR_DIALOG_COPY,
  type Feedback,
  FeedbackProvider,
  useFeedback,
} from './FeedbackProvider.js';

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

describe('FeedbackProvider: toast pressure (REQ-ERR-012)', () => {
  it('a repeated failure refreshes one toast instead of stacking copies', () => {
    vi.useFakeTimers();
    const feedback = mount();
    act(() => {
      feedback().report(new TranRequestError('server.rate_limited', 'slow', 429));
    });
    act(() => vi.advanceTimersByTime(4000));
    act(() => {
      feedback().report(new TranRequestError('server.rate_limited', 'slow', 429));
    });
    expect(screen.getAllByText(/Too many requests/)).toHaveLength(1);
    // The timer restarted: a medium toast is still up 4 s after the second report.
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText(/Too many requests/)).not.toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText(/Too many requests/)).toBeNull();
  });

  it('keeps the newest reference id on a refreshed toast and leaves the others alone', () => {
    const feedback = mount();
    act(() => {
      feedback().acknowledge('server_check_succeeded');
      feedback().report(new TranRequestError('server.internal', 'x', 500, 'req-1'));
      feedback().report(new TranRequestError('server.internal', 'x', 500, 'req-2'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: req-2');
    expect(screen.getByRole('status')).toHaveTextContent('Server check complete');
  });

  it('shows at most three toasts, dropping the oldest', () => {
    const feedback = mount();
    act(() => {
      feedback().report(new TranRequestError('server.internal', 'x', 500));
      feedback().report(new TranRequestError('server.rate_limited', 'x', 429));
      feedback().report(new TranRequestError('auth.forbidden', 'x', 403));
      feedback().acknowledge('server_check_succeeded');
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.children).toHaveLength(3);
    expect(region).not.toHaveTextContent('Something went wrong on our side');
    expect(region).toHaveTextContent('Server check complete');
  });
});

describe('FeedbackProvider: failures that ask (REQ-ERR-010)', () => {
  it('an expired session opens a non-destructive dialog; confirming runs the handlers', async () => {
    const user = userEvent.setup();
    const feedback = mount();
    const signIn = vi.fn();
    const other = vi.fn();
    act(() => {
      feedback().onErrorConfirmed('auth.session_expired', signIn);
      feedback().onErrorConfirmed('auth.forbidden', other);
    });

    let kind = '';
    act(() => {
      kind = feedback().report(new TranRequestError('auth.session_expired', 'x', 401)).kind;
    });
    expect(kind).toBe('dialog');
    const dialog = screen.getByRole('dialog', { name: 'Your session has expired' });
    expect(dialog).toHaveTextContent('Sign in again to continue.');
    expect(screen.getByRole('button', { name: 'Sign in again' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Not now" keeps the screen and runs nothing; an unsubscribed handler never runs', async () => {
    const user = userEvent.setup();
    const feedback = mount();
    const signIn = vi.fn();
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = feedback().onErrorConfirmed('auth.session_expired', signIn);
      feedback().report(new TranRequestError('auth.session_expired', 'x', 401));
    });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(signIn).not.toHaveBeenCalled();

    unsubscribe();
    act(() => {
      feedback().report(new TranRequestError('auth.session_expired', 'x', 401));
    });
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('has copy for every failure the catalogue presents as a dialog', () => {
    for (const spec of ERROR_CATALOGUE) {
      if (spec.presentation.kind === 'dialog') {
        expect(ERROR_DIALOG_COPY[spec.code], spec.code).toBeDefined();
      }
    }
  });

  it('forbidden and conflict are toasts, not malformed requests', () => {
    const feedback = mount();
    act(() => {
      feedback().report(new TranRequestError('auth.forbidden', 'x', 403));
      feedback().report(new TranRequestError('request.conflict', 'x', 409));
    });
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have permission to do that.");
    expect(screen.getByRole('status')).toHaveTextContent('This changed while you were working');
  });
});
