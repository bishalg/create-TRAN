import { type FormEvent, useRef, useState } from 'react';
import { type SupportedLocale, parseAgeInput, t } from '@tran/core';
import type { TranApi } from '../../shared/api/useTranApi.js';
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
}

export function EligibilityPage({ api, locale }: EligibilityPageProps) {
  const [mode, setMode] = useState<CheckMode>('device');
  const [age, setAge] = useState('21');
  const [country, setCountry] = useState('US');
  const [ageRejected, setAgeRejected] = useState(false);
  const ageField = useRef<HTMLInputElement>(null);

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

  return (
    <>
      {api.banner && <TranBanner>{t(api.banner.spec.messageKey, locale)}</TranBanner>}

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

        <TranButton type="submit" disabled={api.isChecking} aria-busy={api.isChecking}>
          {t(api.isChecking ? 'eligibility.submitting' : 'eligibility.submit', locale)}
        </TranButton>
      </form>

      {alertKey && (
        <TranText variant="danger" className="error" role="alert">
          {t(alertKey, locale)}
        </TranText>
      )}

      {/* Always mounted: screen readers only announce changes inside a region that already exists. */}
      <div className="result-slot" role="status" aria-label={t('eligibility.result.label', locale)}>
        {result && <ResultCard result={result} locale={locale} />}
      </div>
    </>
  );
}
