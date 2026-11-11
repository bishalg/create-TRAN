/**
 * Toast pressure, banner recovery timing and the error reporter (ADR-0036). The numbers come from
 * Rust via `./generated/feedback.ts`; these functions mirror `admit_toast` and
 * `recovery_probe_delay_ms`, pinned by `fixtures/feedback.json`.
 */
import {
  RECOVERY_POLICY,
  TOAST_POLICY,
  type ErrorCode,
  type LogLevel,
  type ToastTone,
} from './generated/feedback.js';

export { RECOVERY_POLICY, TOAST_POLICY };

/** What makes two toasts "the same": their message and tone. */
export interface ToastKey {
  readonly messageKey: string;
  readonly tone: ToastTone;
}

/** Restart the visible copy at `index`, or append after dismissing the `evictOldest` oldest. */
export type ToastAdmission =
  { kind: 'refresh'; index: number } | { kind: 'append'; evictOldest: number };

/** How `incoming` joins `visible` (oldest first) — REQ-ERR-012. */
export function admitToast(visible: readonly ToastKey[], incoming: ToastKey): ToastAdmission {
  const index = visible.findIndex(
    (toast) => toast.messageKey === incoming.messageKey && toast.tone === incoming.tone
  );
  if (index >= 0) return { kind: 'refresh', index };
  return {
    kind: 'append',
    evictOldest: Math.max(visible.length + 1 - TOAST_POLICY.maxVisible, 0),
  };
}

/** `min(max, first × 2^(probe−1))`; probe 0 and `NaN` count as the first (REQ-ERR-013). */
export function recoveryProbeDelayMs(probe: number): number {
  const step = Number.isNaN(probe) ? 0 : Math.min(Math.max(probe - 1, 0), 16);
  return Math.min(RECOVERY_POLICY.firstProbeMs * 2 ** step, RECOVERY_POLICY.maxProbeMs);
}

/** Only `error` means "a human must look" (REQ-ERR-014). */
export function isReportedLogLevel(level: LogLevel): boolean {
  return level === 'error';
}

/** Exactly the `LOG_EVENT` fields — never a payload. */
export interface ReportEvent {
  readonly code: ErrorCode;
  readonly status: number | null;
  readonly request_id: string | undefined;
  readonly trace_id: string | undefined;
}

/** Sentry, an HTTP sink, … `cause` is only passed for client-side (`client.*`) codes. */
export type ErrorReporter = (event: ReportEvent, cause: unknown) => void;

let reporter: ErrorReporter | null = null;

/** Installs the app's one reporter; `null` removes it. The template ships none. */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

/** Called by `logFailure`; a reporter that throws must not break the app. */
export function reportFailure(event: ReportEvent, cause: unknown): void {
  try {
    reporter?.(event, event.code.startsWith('client.') ? cause : undefined);
  } catch {
    // The reporter is best effort; the failure has already been logged.
  }
}
