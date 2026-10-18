import { describe, expect, it } from 'vitest';
import { toView } from './toView.js';

const device = {
  eligible: true,
  age: 20,
  minimumAge: 18,
  countryCode: 'NP',
  reason: 'device reason',
};

const server = {
  eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
  eligible: false,
  age: 16,
  minimum_age: 18,
  country_code: 'US',
  country_source: 'x-debug-country',
  client_ip: '127.0.0.1',
  reason: 'server reason',
  evaluated_at: '2026-10-18T00:00:00Z',
};

describe('toView', () => {
  it('shows the device result in device mode', () => {
    expect(toView('device', device, server)).toMatchObject({
      eligible: true,
      countryCode: 'NP',
      minimumAge: 18,
      source: 'device',
    });
  });

  it('maps the snake_case API result in server mode', () => {
    expect(toView('server', device, server)).toEqual({
      eligible: false,
      reason: 'server reason',
      countryCode: 'US',
      minimumAge: 18,
      source: 'server',
    });
  });

  it('returns null until the active mode has a result', () => {
    expect(toView('device', null, server)).toBeNull();
    expect(toView('server', device, null)).toBeNull();
  });
});
