import { Component, type ReactNode, useEffect, useRef } from 'react';
import { logFailure, type SupportedLocale, t, TranRequestError } from '@tran/core';
import { TranButton } from '../ui/TranButton.js';
import { TranStack } from '../ui/TranStack.js';
import { TranSurface } from '../ui/TranSurface.js';
import { TranText } from '../ui/TranText.js';

export interface CrashBoundaryProps {
  locale: SupportedLocale;
  /** Tests inject this; the app reloads the page. */
  onReload?: () => void;
  children: ReactNode;
}

interface CrashBoundaryState {
  crashed: boolean;
}

/**
 * The `screen` presentation (REQ-ERR-011, ADR-0036): the one place a broken view tree is caught.
 * It sits outside every provider so it still works when a provider is what broke.
 */
export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
  state: CrashBoundaryState = { crashed: false };

  static getDerivedStateFromError(): CrashBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    logFailure(new TranRequestError('client.render_failed', message, null, undefined, null, error));
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    const { locale, onReload = () => window.location.reload() } = this.props;
    return <CrashScreen locale={locale} onReload={onReload} />;
  }
}

function CrashScreen({ locale, onReload }: { locale: SupportedLocale; onReload: () => void }) {
  const heading = useRef<HTMLElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <TranSurface padding="lg">
      <TranStack gap="md">
        <TranText variant="title" as="h1" tabIndex={-1} ref={heading}>
          {t('errors.renderFailed', locale)}
        </TranText>
        <TranText role="alert">{t('errors.renderFailedBody', locale)}</TranText>
        <TranButton onClick={onReload}>{t('common.reload', locale)}</TranButton>
      </TranStack>
    </TranSurface>
  );
}
