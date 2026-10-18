import type { OfflineEligibilityResult, VoteEligibilityOutput } from '@tran/core';
import type { EligibilityView } from './ResultCard.js';

export type CheckMode = 'device' | 'server';

/** Maps either result shape (camelCase device, snake_case API) onto what the card renders. */
export function toView(
  mode: CheckMode,
  device: OfflineEligibilityResult | null,
  server: VoteEligibilityOutput | null
): EligibilityView | null {
  if (mode === 'device') return device && { ...device, source: 'device' };
  return (
    server && {
      eligible: server.eligible,
      reason: server.reason,
      countryCode: server.country_code,
      minimumAge: server.minimum_age,
      source: 'server',
    }
  );
}
