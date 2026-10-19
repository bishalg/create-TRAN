import { type UserRole } from '@tran/core';
import { TranButton } from '../../shared/ui/TranButton.js';
import { TranStack } from '../../shared/ui/TranStack.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuthWelcomePageProps {
  onSelectRole: (role: UserRole) => void;
}

export function AuthWelcomePage({ onSelectRole }: AuthWelcomePageProps) {
  return (
    <div className="auth-welcome card">
      <TranText variant="title" as="h2">
        Welcome to TRAN Voting
      </TranText>
      <TranText variant="body">Select your role to continue into the application:</TranText>
      <TranStack className="auth-branches" gap="md">
        <TranButton type="button" onClick={() => onSelectRole('citizen_voter')}>
          Continue as Citizen Voter
        </TranButton>
        <TranButton type="button" onClick={() => onSelectRole('election_auditor')}>
          Continue as Election Auditor
        </TranButton>
      </TranStack>
    </div>
  );
}
