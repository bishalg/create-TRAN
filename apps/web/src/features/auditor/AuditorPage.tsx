import { COUNTRY_VOTING_AGES, type SupportedLocale, t } from '@tran/core';
import { TranBox } from '../../shared/ui/TranBox.js';
import { TranButton } from '../../shared/ui/TranButton.js';
import { TranStack } from '../../shared/ui/TranStack.js';
import { TranTable, TranTd, TranTh } from '../../shared/ui/TranTable.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuditorPageProps {
  locale: SupportedLocale;
  onBackToVoter: () => void;
}

export function AuditorPage({ locale, onBackToVoter }: AuditorPageProps) {
  const entries = Object.entries(COUNTRY_VOTING_AGES);

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
            {entries.map(([country, minAge]) => (
              <tr key={country}>
                <TranTd>{country}</TranTd>
                <TranTd>{t('auditor.years', locale, { years: minAge })}</TranTd>
                <TranTd>{t('auditor.table.verified', locale)}</TranTd>
              </tr>
            ))}
          </tbody>
        </TranTable>
      </TranBox>
      <TranStack gap="lg">
        <TranButton type="button" onClick={onBackToVoter}>
          {t('auditor.backToVoter', locale)}
        </TranButton>
      </TranStack>
    </div>
  );
}
