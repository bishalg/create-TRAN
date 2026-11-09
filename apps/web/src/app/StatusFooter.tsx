import { ScreenIds, type SupportedLocale, type TranStringKey, t } from '@tran/core';
import { TranText } from '../shared/ui/TranText.js';

export type ApiState = 'checking' | 'online' | 'offline';

const LABEL: Record<ApiState, TranStringKey> = {
  checking: 'shell.status.checking',
  online: 'shell.status.online',
  offline: 'shell.status.offline',
};

export interface StatusFooterProps {
  state: ApiState;
  version?: string;
  locale: SupportedLocale;
  /**
   * Shows the status pill. The footer landmark is on every page (REQ-A11Y-010); the screen
   * contract offers the API status on the voter dashboard only.
   */
  showStatus?: boolean;
}

export function StatusFooter({ state, version, locale, showStatus = true }: StatusFooterProps) {
  return (
    <footer className="status" data-state={state}>
      {showStatus && (
        <TranText
          variant="caption"
          as="span"
          role="status"
          className="status-pill"
          aria-label={t('shell.status.label', locale)}
          data-testid={ScreenIds.eligibility.apiStatus}
        >
          <div className="dot" aria-hidden="true" /> {t(LABEL[state], locale)}
          {state === 'online' && version ? ` · v${version}` : ''}
        </TranText>
      )}
    </footer>
  );
}
