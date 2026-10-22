import type { OfflineEligibilityResult, VerdictSource, VoteEligibilityOutput } from '@tran/core';
import type { EligibilityView } from './ResultCard.js';

export type CheckMode = 'device' | 'server';

const fromDevice = (
  device: OfflineEligibilityResult,
  source: Extract<VerdictSource, 'device' | 'device_fallback'>
): EligibilityView => ({
  eligible: device.eligible,
  age: device.age,
  countryCode: device.countryCode,
  minimumAge: device.minimumAge,
  source,
});

/**
 * Maps either result shape (camelCase device, snake_case API) onto what the card renders.
 * The English `reason` is deliberately dropped: the card builds its sentence from these facts.
 * In server mode a `fallback` (the device verdict after a failed server check, REQ-ERR-005)
 * wins, labelled `device_fallback` so it never reads like a device-mode check (REQ-LOAD-005).
 */
export function toView(
  mode: CheckMode,
  device: OfflineEligibilityResult | null,
  server: VoteEligibilityOutput | null,
  fallback: OfflineEligibilityResult | null = null
): EligibilityView | null {
  if (mode === 'device') return device && fromDevice(device, 'device');
  if (fallback) return fromDevice(fallback, 'device_fallback');
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
