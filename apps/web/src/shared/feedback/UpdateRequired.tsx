import { useEffect, useRef } from 'react';
import { errorSpec, ScreenIds, type SupportedLocale, t } from '@tran/core';
import { TranButton } from '../ui/TranButton.js';
import { TranStack } from '../ui/TranStack.js';
import { TranSurface } from '../ui/TranSurface.js';
import { TranText } from '../ui/TranText.js';

export interface UpdateRequiredProps {
  locale: SupportedLocale;
  /** The app reloads, which loads the newest web build (REQ-VER-009). */
  onUpdate: () => void;
}

const SPEC = errorSpec('client.upgrade_required');

/**
 * The `screen` presentation of `client.upgrade_required` (REQ-VER-009): the API no longer serves
 * this version. It replaces everything, has no way back, and keeps the session: reloading loads
 * the current build, which the API serves again.
 */
export function UpdateRequired({ locale, onUpdate }: UpdateRequiredProps) {
  const heading = useRef<HTMLElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <TranSurface padding="lg">
      <TranStack gap="md">
        <TranText variant="title" as="h1" tabIndex={-1} ref={heading}>
          {t(SPEC.messageKey, locale)}
        </TranText>
        <TranText role="alert">{t('errors.updateRequiredBody', locale)}</TranText>
        <TranButton onClick={onUpdate} data-testid={ScreenIds.eligibility.updateButton}>
          {t('common.update', locale)}
        </TranButton>
      </TranStack>
    </TranSurface>
  );
}
