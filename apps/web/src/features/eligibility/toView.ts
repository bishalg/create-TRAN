import type { OfflineEligibilityResult, VoteEligibilityOutput } from '@tran/core';
import type { EligibilityView } from './ResultCard.js';

export type CheckMode = 'device' | 'server';

/**
 * Maps either result shape (camelCase device, snake_case API) onto what the card renders.
 * The English `reason` is deliberately dropped: the card builds its sentence from these facts.
 */
export function toView(
  mode: CheckMode,
  device: OfflineEligibilityResult | null,
  server: VoteEligibilityOutput | null
): EligibilityView | null {
  if (mode === 'device') {
    return (
      device && {
        eligible: device.eligible,
        age: device.age,
        countryCode: device.countryCode,
        minimumAge: device.minimumAge,
        source: 'device',
      }
    );
  }
  return (
    server && {
      eligible: server.eligible,
      age: server.age,
      countryCode: server.country_code,
      minimumAge: server.minimum_age,
      source: 'server',
    }
  );
}
