import { type SupportedLocale, t } from '@tran/core';

export type ApiState = 'checking' | 'online' | 'offline';

const LABEL: Record<ApiState, string> = {
  checking: 'app.statusChecking',
  online: 'app.statusOnline',
  offline: 'app.statusOffline',
};

export interface StatusFooterProps {
  state: ApiState;
  version?: string;
  locale: SupportedLocale;
}

export function StatusFooter({ state, version, locale }: StatusFooterProps) {
  return (
    <footer className="status" data-state={state}>
      <span role="status" className="status-pill">
        <span className="dot" aria-hidden="true" /> {t(LABEL[state], locale)}
        {state === 'online' && version ? ` · v${version}` : ''}
      </span>
    </footer>
  );
}
