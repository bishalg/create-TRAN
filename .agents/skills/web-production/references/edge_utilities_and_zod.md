# Edge Utilities & Zod Validation Guide

This guide establishes zero-dependency edge utility standards and typed API request validation, based on **Dub (`dubinc/dub` `packages/utils`)**.

---

## 1. Zero-Dependency TypeScript Utilities

Shared utilities in monorepos must run without Node.js-only modules (`fs`, `net`, `crypto` native binaries) to maintain compatibility with Cloudflare Workers, Vercel Edge Runtime, and browser environments.

### Resilient Fetcher with Retry
```typescript
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = 3,
  backoffMs = 500
): Promise<T> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (res.status >= 500 && retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return fetchWithRetry<T>(url, options, retries - 1, backoffMs * 2);
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return fetchWithRetry<T>(url, options, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}
```

---

## 2. Safe URL Sanitization

```typescript
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function getCleanDomain(input: string): string {
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return input;
  }
}
```

---

## 3. Zod API Request Middleware

Standardize API route error handling in Route Handlers (`app/api/.../route.ts`):

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';

export function withValidation<T>(
  schema: z.ZodSchema<T>,
  handler: (data: T, req: Request) => Promise<NextResponse>
) {
  return async (req: Request) => {
    try {
      const json = await req.json();
      const parseResult = schema.safeParse(json);
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid payload', details: parseResult.error.flatten() },
          { status: 400 }
        );
      }
      return await handler(parseResult.data, req);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }
  };
}
```
