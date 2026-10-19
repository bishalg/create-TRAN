import { type SupportedLocale, t } from '@tran/core';
import { TranText } from '../../shared/ui/TranText.js';
import { CheckIcon, CrossIcon } from '../../shared/ui/icons.js';

export interface EligibilityView {
  eligible: boolean;
  reason: string;
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
      <span className="result-badge" aria-hidden="true">
        {result.eligible ? <CheckIcon /> : <CrossIcon />}
      </span>
      <div>
        <TranText variant="title">
          {t(result.eligible ? 'app.eligibleYes' : 'app.eligibleNo', locale)}
        </TranText>
        <TranText variant="body">{result.reason}</TranText>
        <ul className="chips">
          <li className="chip">
            <TranText variant="caption" as="span">
              {t('app.resultCountry', locale)}: <b>{result.countryCode}</b>
            </TranText>
          </li>
          <li className="chip">
            <TranText variant="caption" as="span">
              {t('app.resultMinimumAge', locale)}: <b>{result.minimumAge}</b>
            </TranText>
          </li>
          <li className="chip">
            <TranText variant="caption" as="span">
              {t(result.source === 'device' ? 'app.sourceDevice' : 'app.sourceServer', locale)}
            </TranText>
          </li>
        </ul>
      </div>
    </article>
  );
}
