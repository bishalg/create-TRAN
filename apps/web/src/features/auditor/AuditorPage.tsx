import { SUPPORTED_COUNTRIES, type SupportedLocale, type TranStringKey, t } from '@tran/core';
import { TranBanner } from '../../shared/ui/TranBanner.js';
import { TranBox } from '../../shared/ui/TranBox.js';
import { TranTable, TranTd, TranTh } from '../../shared/ui/TranTable.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuditorPageProps {
  locale: SupportedLocale;
  /** The connectivity notice, when the API cannot be reached (a failed deletion, REQ-ACC-006). */
  notice?: TranStringKey;
}

/** The auditor's screen offers what the contract declares: changing role goes through sign-out. */
export function AuditorPage({ locale, notice }: AuditorPageProps) {
  return (
    <>
      {notice && <TranBanner>{t(notice, locale)}</TranBanner>}
      <div className="auditor-page card">
        <TranText variant="title" as="h2">
          {t('auditor.title', locale)}
        </TranText>
        <TranText variant="body">{t('auditor.subtitle', locale)}</TranText>
        <TranBox className="auditor-table-wrap" padding="none">
          <TranTable>
            <thead>
              <tr>
                <TranTh>{t('auditor.table.countryCode', locale)}</TranTh>
                <TranTh>{t('auditor.table.minimumAge', locale)}</TranTh>
                <TranTh>{t('auditor.table.ruleSource', locale)}</TranTh>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_COUNTRIES.map(({ countryCode, minimumAge }) => (
                <tr key={countryCode}>
                  <TranTd>{countryCode}</TranTd>
                  <TranTd>{t('auditor.years', locale, { years: minimumAge })}</TranTd>
                  <TranTd>{t('auditor.table.verified', locale)}</TranTd>
                </tr>
              ))}
            </tbody>
          </TranTable>
        </TranBox>
      </div>
    </>
  );
}
