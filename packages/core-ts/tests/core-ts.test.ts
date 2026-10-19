import { describe, it, expect, vi } from 'vitest';
import { TranApiClient } from '../src/client.js';
import { getThemeTokens, liquidGlassTokens } from '../src/tokens.js';
import { locales, t, translate } from '../src/i18n.js';
import {
  canVoteByAge,
  evaluateVoteEligibilityOffline,
  votingAgeForCountry,
} from '../src/voting.js';

describe('Liquid Glass Tokens', () => {
  it('exposes light and dark themes with eligibility colors', () => {
    expect(liquidGlassTokens.glass.blur.md).toBe('16px');
    expect(getThemeTokens('light').palette.eligibility.canVote).toBe('#059669');
    expect(getThemeTokens('dark').palette.eligibility.cannotVote).toBe('#f87171');
  });
});

describe('Voting parity (TS mirror of Rust core)', () => {
  it('matches country voting ages', () => {
    expect(votingAgeForCountry('us')).toBe(18);
    expect(votingAgeForCountry('BR')).toBe(16);
  });

  it('matches age boundary rules', () => {
    expect(canVoteByAge(17, 18)).toBe(false);
    expect(canVoteByAge(18, 18)).toBe(true);
  });

  it('evaluates offline eligibility', () => {
    const result = evaluateVoteEligibilityOffline({ age: 20, countryCode: 'NP' });
    expect(result.eligible).toBe(true);
    expect(result.minimumAge).toBe(18);
  });
});

describe('i18n Translations', () => {
  it('should translate voting demo title in English', () => {
    expect(t('shell.title', 'en')).toBe('Voting Eligibility');
  });

  it('should translate correctly for Nepali', () => {
    expect(t('shell.title', 'ne')).toBe('मतदान योग्यता');
  });

  it('should fallback to key if not found', () => {
    expect(translate(locales, 'non.existent.key', 'en')).toBe('non.existent.key');
  });
});

describe('TranApiClient', () => {
  it('should call health check endpoint correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        report_id: '12345',
        timestamp: '2026-10-18T00:00:00Z',
        overall_status: 'HEALTHY',
        components: [],
      }),
    });

    const client = new TranApiClient({
      baseUrl: 'http://localhost:3001',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const health = await client.getHealth();

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/health', expect.any(Object));
    expect(health.overall_status).toBe('HEALTHY');
  });

  it('should validate vote eligibility responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
        eligible: true,
        age: 21,
        minimum_age: 18,
        country_code: 'US',
        country_source: 'x-debug-country',
        client_ip: '127.0.0.1',
        reason: 'ok',
        evaluated_at: '2026-10-18T00:00:00Z',
      }),
    });

    const client = new TranApiClient({
      baseUrl: 'http://localhost:3001',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const res = await client.checkVoteEligibility({ age: 21 });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/vote/eligibility',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.eligible).toBe(true);
  });
});
