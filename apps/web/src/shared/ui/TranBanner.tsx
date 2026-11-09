import type { ReactNode } from 'react';
import { InfoIcon, WarningIcon } from './icons.js';

export type TranBannerTone = 'info' | 'warning';

export interface TranBannerProps {
  tone?: TranBannerTone;
  children: ReactNode;
  className?: string;
  /** The screen contract's element id (REQ-SCR-002). */
  'data-testid'?: string;
}

/**
 * Persistent, non-blocking notice for a condition that is still true — the API is unreachable —
 * removed by its owner when the condition clears (REQ-ERR-006). Never auto-dismisses.
 */
export function TranBanner({
  tone = 'warning',
  children,
  className,
  'data-testid': testId,
}: TranBannerProps) {
  const Icon = tone === 'warning' ? WarningIcon : InfoIcon;
  return (
    <div
      className={['tran-banner', className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-testid={testId}
      role="status"
    >
      <span className="tran-banner-icon">
        <Icon />
      </span>
      <p className="tran-banner-text">{children}</p>
    </div>
  );
}
