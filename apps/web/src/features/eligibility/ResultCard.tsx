import {
  LOADING_POLICY,
  ScreenIds,
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
 * The result card and, inside it, the result's live region (`role="status"`, REQ-A11Y-003). The
 * card is always mounted, because screen readers only announce changes inside a region that
 * already exists; with no result it draws nothing but the region (`data-empty`).
 *
 * The region holds the reason sentence alone, the result text every platform shows
 * (ADR-0038); the verdict heading and the chips are its siblings. With no result yet it holds the
 * pending copy while a server check runs (REQ-LOAD-002).
 *
 * `updating`: a newer check is pending — the verdict stays, the source chip says it is being
 * re-checked, and the card is toned down through a token (REQ-LOAD-003).
 */
export function ResultCard({
  result,
  locale,
  updating = false,
}: {
  result: EligibilityView | null;
  locale: SupportedLocale;
  updating?: boolean;
}) {
  const reason = result
    ? t(
        result.eligible ? 'eligibility.result.reasonMeets' : 'eligibility.result.reasonBelow',
        locale,
        { age: result.age, minimumAge: result.minimumAge, country: result.countryCode }
      )
    : updating
      ? t(LOADING_POLICY.pendingMessageKey, locale)
      : null;
  return (
    <article
      className="result"
      data-empty={result ? undefined : 'true'}
      data-eligible={result?.eligible}
      data-updating={updating && result ? 'true' : undefined}
    >
      {result && (
        <div className="result-badge" aria-hidden="true">
          {result.eligible ? <CheckIcon /> : <CrossIcon />}
        </div>
      )}
      <div>
        {result && (
          <TranText variant="title">
            {t(
              result.eligible ? 'eligibility.verdict.eligible' : 'eligibility.verdict.ineligible',
              locale
            )}
          </TranText>
        )}
        <TranText
          variant={result ? 'body' : 'muted'}
          role="status"
          aria-label={t('eligibility.result.label', locale)}
          aria-busy={updating}
          data-testid={ScreenIds.eligibility.offlineResult}
        >
          {reason}
        </TranText>
        {result && (
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
              <TranText
                variant="caption"
                as="span"
                data-testid={ScreenIds.eligibility.verdictSource}
              >
                <TranText variant="caption" as="span" className="sr-only">
                  {`${t('eligibility.result.source', locale)}: `}
                </TranText>
                <TranText variant="caption" as="span">
                  {t(
                    updating
                      ? LOADING_POLICY.pendingMessageKey
                      : verdictSourceMessageKey(result.source),
                    locale
                  )}
                </TranText>
              </TranText>
            </li>
          </ul>
        )}
      </div>
    </article>
  );
}
