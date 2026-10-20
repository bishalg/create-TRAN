import { type ReactNode, useEffect, useRef } from 'react';
import { CheckIcon, CrossIcon, InfoIcon, WarningIcon } from './icons.js';

export type TranToastTone = 'success' | 'info' | 'warning' | 'error';

const ICONS: Record<TranToastTone, () => ReactNode> = {
  success: CheckIcon,
  info: InfoIcon,
  warning: WarningIcon,
  error: CrossIcon,
};

export interface TranToastProps {
  tone: TranToastTone;
  message: string;
  /** Small secondary line, e.g. "Reference: 1f0c…" for a server failure (REQ-ERR-009). */
  detail?: string;
  /** From the catalogue (`TOAST_DURATIONS_MS`); the toast removes itself after this long. */
  durationMs: number;
  dismissLabel: string;
  onDismiss: () => void;
}

/**
 * Non-blocking notification (REQ-ERR-006). The countdown pauses while the pointer or keyboard
 * focus is on the toast (WCAG 2.2.1), and resumes with the time that was left.
 */
export function TranToast({
  tone,
  message,
  detail,
  durationMs,
  dismissLabel,
  onDismiss,
}: TranToastProps) {
  const remaining = useRef(durationMs);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const resume = () => {
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismiss.current(), remaining.current);
  };
  const pause = () => {
    clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };

  useEffect(() => {
    resume();
    return () => clearTimeout(timer.current);
  }, []);

  const Icon = ICONS[tone];
  return (
    <div
      className="tran-toast"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className="tran-toast-icon">
        <Icon />
      </span>
      <div className="tran-toast-body">
        <p className="tran-toast-message">{message}</p>
        {detail && <p className="tran-toast-detail">{detail}</p>}
      </div>
      <button
        type="button"
        className="tran-toast-dismiss"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <CrossIcon />
      </button>
    </div>
  );
}

export interface TranToastRegionProps {
  label: string;
  children: ReactNode;
}

/** Fixed, always-mounted landmark so screen readers announce toasts as they arrive. */
export function TranToastRegion({ label, children }: TranToastRegionProps) {
  return (
    <section className="tran-toast-region" aria-label={label}>
      {children}
    </section>
  );
}
