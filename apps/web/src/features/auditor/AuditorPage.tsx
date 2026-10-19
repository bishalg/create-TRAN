import { COUNTRY_VOTING_AGES } from '@tran/core';
import { TranBox } from '../../shared/ui/TranBox.js';
import { TranButton } from '../../shared/ui/TranButton.js';
import { TranStack } from '../../shared/ui/TranStack.js';
import { TranTable, TranTd, TranTh } from '../../shared/ui/TranTable.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuditorPageProps {
  onBackToVoter: () => void;
}

export function AuditorPage({ onBackToVoter }: AuditorPageProps) {
  const entries = Object.entries(COUNTRY_VOTING_AGES);

  return (
    <div className="auditor-page card">
      <TranText variant="title" as="h2">
        Election Auditor Dashboard
      </TranText>
      <TranText variant="body">
        Global voting age rules verified against rust-core parity fixtures.
      </TranText>
      <TranBox className="auditor-table-wrap" padding="none">
        <TranTable>
          <thead>
            <tr>
              <TranTh>Country Code</TranTh>
              <TranTh>Minimum Voting Age</TranTh>
              <TranTh>Rule Source</TranTh>
            </tr>
          </thead>
          <tbody>
            {entries.map(([country, minAge]) => (
              <tr key={country}>
                <TranTd>{country}</TranTd>
                <TranTd>{minAge} years</TranTd>
                <TranTd>rust-core verified</TranTd>
              </tr>
            ))}
          </tbody>
        </TranTable>
      </TranBox>
      <TranStack gap="lg">
        <TranButton type="button" onClick={onBackToVoter}>
          Switch to Citizen Voter
        </TranButton>
      </TranStack>
    </div>
  );
}
