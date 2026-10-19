import { type SupportedLocale, type TranStringKey, t } from '@tran/core';
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
}

export function StatusFooter({ state, version, locale }: StatusFooterProps) {
  return (
    <footer className="status" data-state={state}>
      <TranText variant="caption" as="span" role="status" className="status-pill">
        <div className="dot" aria-hidden="true" /> {t(LABEL[state], locale)}
        {state === 'online' && version ? ` · v${version}` : ''}
      </TranText>
    </footer>
  );
}
