import { type SupportedLocale, t } from '@tran/core';
import { TranText } from '../../shared/ui/TranText.js';
import { CheckIcon, CrossIcon } from '../../shared/ui/icons.js';

export interface EligibilityView {
  eligible: boolean;
  age: number;
  countryCode: string;
  minimumAge: number;
  source: 'device' | 'server';
}

export function ResultCard({
  result,
  locale,
}: {
  result: EligibilityView;
  locale: SupportedLocale;
}) {
  return (
    <article className="result" data-eligible={result.eligible}>
      <div className="result-badge" aria-hidden="true">
        {result.eligible ? <CheckIcon /> : <CrossIcon />}
      </div>
      <div>
        <TranText variant="title">
          {t(
            result.eligible ? 'eligibility.verdict.eligible' : 'eligibility.verdict.ineligible',
            locale
          )}
        </TranText>
        <TranText variant="body">
          {t(
            result.eligible ? 'eligibility.result.reasonMeets' : 'eligibility.result.reasonBelow',
            locale,
            { age: result.age, minimumAge: result.minimumAge, country: result.countryCode }
          )}
        </TranText>
        <ul className="chips">
          <li className="chip">
            <TranText variant="caption" as="span">
              {t('eligibility.result.country', locale)}: <b>{result.countryCode}</b>
            </TranText>
          </li>
          <li className="chip">
            <TranText variant="caption" as="span">
              {t('eligibility.result.minimumAge', locale)}: <b>{result.minimumAge}</b>
            </TranText>
          </li>
          <li className="chip">
            <TranText variant="caption" as="span">
              {t(
                result.source === 'device'
                  ? 'eligibility.result.sourceDevice'
                  : 'eligibility.result.sourceServer',
                locale
              )}
            </TranText>
          </li>
        </ul>
      </div>
    </article>
  );
}
