import { useEffect } from 'react';
import { classifyError } from '@tran/core';
import type { Feedback } from './FeedbackProvider.js';

/**
 * Errors nothing caught — outside rendering, or a promise nobody awaited — are classified like any
 * other failure (usually `client.unexpected`) and reported once (REQ-ERR-011). Render errors are
 * `CrashBoundary`'s.
 */
export function useGlobalErrors(feedback: Feedback): void {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      feedback.report(classifyError(event.error ?? event.message));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      // The DOM's rejection value — not the core's English `reason`, which the i18n guard bans.
      feedback.report(classifyError(event['reason']));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [feedback]);
}
