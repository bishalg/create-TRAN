import { type UserRole } from '@tran/core';

export interface AuthWelcomePageProps {
  onSelectRole: (role: UserRole) => void;
}

export function AuthWelcomePage({ onSelectRole }: AuthWelcomePageProps) {
  return (
    <div className="auth-welcome card">
      <h2>Welcome to TRAN Voting</h2>
      <p>Select your role to continue into the application:</p>
      <div
        className="auth-branches"
        style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}
      >
        <button type="button" className="button" onClick={() => onSelectRole('citizen_voter')}>
          Continue as Citizen Voter
        </button>
        <button type="button" className="button" onClick={() => onSelectRole('election_auditor')}>
          Continue as Election Auditor
        </button>
      </div>
    </div>
  );
}
