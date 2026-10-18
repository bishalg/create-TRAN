import { type SupportedLocale, t } from '@tran/core';
import { CheckIcon, CrossIcon } from './icons.js';

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
        <h2>{t(result.eligible ? 'app.eligibleYes' : 'app.eligibleNo', locale)}</h2>
        <p>{result.reason}</p>
        <ul className="chips">
          <li className="chip">
            {t('app.resultCountry', locale)}: <b>{result.countryCode}</b>
          </li>
          <li className="chip">
            {t('app.resultMinimumAge', locale)}: <b>{result.minimumAge}</b>
          </li>
          <li className="chip">
            {t('app.resultSource', locale)}:{' '}
            <b>{t(result.source === 'device' ? 'app.sourceDevice' : 'app.sourceServer', locale)}</b>
          </li>
        </ul>
      </div>
    </article>
  );
}
