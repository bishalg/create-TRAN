import { describe, expect, it, vi } from 'vitest';
import { VoteEligibilityOutputSchema } from '../src/schemas/vote.js';
import { checkVoteEligibility } from '../src/client.js';

describe('@tran/api vote contract', () => {
  it('validates eligibility responses with Zod', () => {
    const sample = VoteEligibilityOutputSchema.parse({
      eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
      eligible: true,
      age: 21,
      minimum_age: 18,
      country_code: 'US',
      country_source: 'loopback-default',
      client_ip: '127.0.0.1',
      reason: 'Age 21 meets the minimum voting age of 18 in US.',
      evaluated_at: '2026-10-18T00:00:00Z',
    });
    expect(sample.eligible).toBe(true);
  });

  it('checkVoteEligibility posts to Axum route', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
        eligible: false,
        age: 16,
        minimum_age: 18,
        country_code: 'US',
        country_source: 'default',
        client_ip: '8.8.8.8',
        reason: 'Age 16 is below the minimum voting age of 18 in US.',
        evaluated_at: '2026-10-18T00:00:00Z',
      }),
    });

    const result = await checkVoteEligibility(
      { age: 16 },
      { baseUrl: 'http://localhost:3001', fetchFn: mockFetch as unknown as typeof fetch }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/vote/eligibility',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.eligible).toBe(false);
  });
});
