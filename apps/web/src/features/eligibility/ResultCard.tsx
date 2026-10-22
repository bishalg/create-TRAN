import {
  LOADING_POLICY,
  type SupportedLocale,
  t,
  type VerdictSource,
  verdictSourceMessageKey,
} from '@tran/core';
import { TranText } from '../../shared/ui/TranText.js';
import { CheckIcon, CrossIcon } from '../../shared/ui/icons.js';

export interface EligibilityView {
  eligible: boolean;
  age: number;
  countryCode: string;
  minimumAge: number;
  source: VerdictSource;
}

/**
 * `updating`: a newer check is pending — the verdict stays, the source chip says it is being
 * re-checked, and the card is toned down through a token (REQ-LOAD-003).
 */
export function ResultCard({
  result,
  locale,
  updating = false,
}: {
  result: EligibilityView;
  locale: SupportedLocale;
  updating?: boolean;
}) {
  return (
    <article
      className="result"
      data-eligible={result.eligible}
      data-updating={updating ? 'true' : undefined}
    >
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
                updating
                  ? LOADING_POLICY.pendingMessageKey
                  : verdictSourceMessageKey(result.source),
                locale
              )}
            </TranText>
          </li>
        </ul>
      </div>
    </article>
  );
}
