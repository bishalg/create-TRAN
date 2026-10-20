import type { OfflineEligibilityResult, VoteEligibilityOutput } from '@tran/core';
import type { EligibilityView } from './ResultCard.js';

export type CheckMode = 'device' | 'server';

const fromDevice = (device: OfflineEligibilityResult): EligibilityView => ({
  eligible: device.eligible,
  age: device.age,
  countryCode: device.countryCode,
  minimumAge: device.minimumAge,
  source: 'device',
});

/**
 * Maps either result shape (camelCase device, snake_case API) onto what the card renders.
 * The English `reason` is deliberately dropped: the card builds its sentence from these facts.
 * In server mode a `fallback` (the device verdict after a failed server check, REQ-ERR-005)
 * wins, and the card says honestly that the device decided.
 */
export function toView(
  mode: CheckMode,
  device: OfflineEligibilityResult | null,
  server: VoteEligibilityOutput | null,
  fallback: OfflineEligibilityResult | null = null
): EligibilityView | null {
  if (mode === 'device') return device && fromDevice(device);
  if (fallback) return fromDevice(fallback);
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
