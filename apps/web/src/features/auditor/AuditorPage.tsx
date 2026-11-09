import { SUPPORTED_COUNTRIES, type SupportedLocale, t } from '@tran/core';
import { TranBox } from '../../shared/ui/TranBox.js';
import { TranTable, TranTd, TranTh } from '../../shared/ui/TranTable.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuditorPageProps {
  locale: SupportedLocale;
}

/** The auditor's screen offers what the contract declares: changing role goes through sign-out. */
export function AuditorPage({ locale }: AuditorPageProps) {
  return (
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
  );
}
