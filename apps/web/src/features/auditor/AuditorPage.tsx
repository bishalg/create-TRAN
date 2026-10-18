import { COUNTRY_VOTING_AGES } from '@tran/core';

export interface AuditorPageProps {
  onBackToVoter: () => void;
}

export function AuditorPage({ onBackToVoter }: AuditorPageProps) {
  const entries = Object.entries(COUNTRY_VOTING_AGES);

  return (
    <div className="auditor-page card">
      <h2>Election Auditor Dashboard</h2>
      <p>Global voting age rules verified against rust-core parity fixtures.</p>
      <div style={{ marginTop: '16px', overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px', borderBottom: '1px solid currentColor' }}>
                Country Code
              </th>
              <th style={{ padding: '8px', borderBottom: '1px solid currentColor' }}>
                Minimum Voting Age
              </th>
              <th style={{ padding: '8px', borderBottom: '1px solid currentColor' }}>
                Rule Source
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([country, minAge]) => (
              <tr key={country}>
                <td style={{ padding: '8px' }}>{country}</td>
                <td style={{ padding: '8px' }}>{minAge} years</td>
                <td style={{ padding: '8px' }}>rust-core verified</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '20px' }}>
        <button type="button" className="button" onClick={onBackToVoter}>
          Switch to Citizen Voter
        </button>
      </div>
    </div>
  );
}
