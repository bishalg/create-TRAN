import { type FormEvent, useEffect, useRef, useState } from 'react';
import { LOADING_POLICY, ScreenIds, type SupportedLocale, parseAgeInput, t } from '@tran/core';
import type { TranApi } from '../../shared/api/useTranApi.js';
import { useDelayed } from '../../shared/lib/useDelayed.js';
import { Field } from '../../shared/ui/Field.js';
import { TranBanner } from '../../shared/ui/TranBanner.js';
import { TranButton } from '../../shared/ui/TranButton.js';
import { TranText } from '../../shared/ui/TranText.js';
import { ModeSwitch } from './ModeSwitch.js';
import { ResultCard } from './ResultCard.js';
import { type CheckMode, toView } from './toView.js';

export interface EligibilityPageProps {
  api: TranApi;
  locale: SupportedLocale;
  /** How long a check runs before the screen says so; tests inject `0` or a huge value (REQ-LOAD-002). */
  indicatorDelayMs?: number;
}

export function EligibilityPage({
  api,
  locale,
  indicatorDelayMs = LOADING_POLICY.indicatorDelayMs,
}: EligibilityPageProps) {
  const [mode, setMode] = useState<CheckMode>('device');
  const [age, setAge] = useState('21');
  const [country, setCountry] = useState('US');
  const [ageRejected, setAgeRejected] = useState(false);
  const ageField = useRef<HTMLInputElement>(null);
  const pending = useDelayed(api.isChecking, indicatorDelayMs);
  // Only a server-mode result can be superseded by a check; device mode is synchronous.
  const updating = pending && mode === 'server';

  // The hook lives in the shell and outlives this page: leaving abandons the check (REQ-LOAD-004).
  const { cancelCheck } = api;
  useEffect(() => cancelCheck, [cancelCheck]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAge = parseAgeInput(age);
    setAgeRejected(parsedAge === null);
    if (parsedAge === null) {
      ageField.current?.focus();
      return;
    }

    if (mode === 'device') api.checkOffline(parsedAge, country);
    else await api.checkViaApi(parsedAge, country, { 'X-Debug-Country': country });
  };

  const result = toView(mode, api.lastOfflineResult, api.lastApiResult, api.fallbackResult);
  // Inline (REQ-ERR-006): always the localized copy for the code, never the server's English.
  const fieldCode = ageRejected ? 'validation.age_out_of_range' : api.fieldError?.code;
  const alertKey = ageRejected ? 'errors.ageOutOfRange' : api.fieldError?.spec.messageKey;
  const countryRejected = fieldCode === 'validation.invalid_country_code';
  // The device check is the contract's check button (ADR-0038); asking the server is web-only and
  // carries no contract id.
  const checkButtonId = mode === 'device' ? ScreenIds.eligibility.checkButton : undefined;
  const submitKey = pending
    ? 'eligibility.submitting'
    : mode === 'device'
      ? 'eligibility.checkOffline'
      : 'eligibility.submit';

  return (
    <>
      {api.banner && (
        <TranBanner data-testid={ScreenIds.eligibility.offlineNotice}>
          {t(api.banner.spec.messageKey, locale)}
        </TranBanner>
      )}

      <form
        className="card"
        aria-label={t('eligibility.form.label', locale)}
        onSubmit={onSubmit}
        noValidate
      >
        <ModeSwitch mode={mode} onChange={setMode} locale={locale} />

        <div className="fields">
          <Field
            ref={ageField}
            data-testid={ScreenIds.eligibility.ageField}
            label={t('eligibility.age.label', locale)}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('eligibility.age.example', locale)}
            aria-invalid={fieldCode && !countryRejected ? true : undefined}
          />
          <Field
            label={t('eligibility.country.label', locale)}
            data-testid={ScreenIds.eligibility.countryField}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('eligibility.country.example', locale)}
            aria-invalid={countryRejected ? true : undefined}
            hint={t(
              mode === 'server' ? 'eligibility.country.serverHint' : 'eligibility.country.hint',
              locale
            )}
          />
        </div>

        <TranButton
          type="submit"
          disabled={api.isChecking}
          aria-busy={api.isChecking}
          data-testid={checkButtonId}
        >
          {t(submitKey, locale)}
        </TranButton>
      </form>

      {alertKey && (
        <TranText
          variant="danger"
          className="error"
          role="alert"
          data-testid={ScreenIds.eligibility.validationMessage}
        >
          {t(alertKey, locale)}
        </TranText>
      )}

      <ResultCard result={result} locale={locale} updating={updating} />
    </>
  );
}
