import { describe, it, expect, vi } from 'vitest';
import { TranApiClient } from '../src/client.js';
import { liquidGlassTokens } from '../src/tokens.js';
import { t } from '../src/i18n.js';

describe('Liquid Glass Tokens', () => {
  it('should expose consistent blur and transparency tokens without React dependencies', () => {
    expect(liquidGlassTokens.glass.blur.md).toBe('16px');
    expect(liquidGlassTokens.glass.background.standard).toBe('rgba(255, 255, 255, 0.10)');
    expect(liquidGlassTokens.radii.lg).toBe('20px');
  });
});

describe('i18n Translations', () => {
  it('should translate correctly for English', () => {
    expect(t('app.title', 'en')).toBe('TRAN Stack Monorepo');
    expect(t('layers.rust', 'en')).toBe('Rust Core');
  });

  it('should translate correctly for Nepali', () => {
    expect(t('app.title', 'ne')).toBe('TRAN स्ट्याक मोनोरेपो');
    expect(t('layers.rust', 'ne')).toBe('रस्ट कोर');
  });

  it('should translate correctly for Hindi', () => {
    expect(t('app.title', 'hi')).toBe('TRAN स्टैक मोनोरेपो');
    expect(t('layers.rust', 'hi')).toBe('रस्ट कोर');
  });

  it('should fallback to key if not found', () => {
    expect(t('non.existent.key', 'en')).toBe('non.existent.key');
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

  it('should handle API compute requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        calculation_id: 'calc-1',
        result: 42,
        computed_at: '2026-10-18T00:00:00Z',
        execution_micros: 25,
      }),
    });

    const client = new TranApiClient({
      baseUrl: 'http://localhost:3001',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const res = await client.compute({ a: 21, b: 2, operation: 'multiply' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/tran/compute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ a: 21, b: 2, operation: 'multiply' }),
      })
    );
    expect(res.result).toBe(42);
  });

  it('should handle API error responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Division by zero is not allowed' }),
    });

    const client = new TranApiClient({
      baseUrl: 'http://localhost:3001',
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    await expect(client.compute({ a: 10, b: 0, operation: 'divide' })).rejects.toThrow(
      'Division by zero is not allowed'
    );
  });
});
