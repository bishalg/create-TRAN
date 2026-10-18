# App Router & Server Actions Architecture Guide

This guide establishes the Strict MVC and React Server Component (RSC) patterns for Next.js and TanStack applications, based on **Midday (`midday-ai/midday`)** and **Cal.com (`calcom/cal.com`)**.

---

## 1. Strict MVC Architecture in Next.js

```
+-----------------------------------------------------------+
|                          View                             |
|   "Dumb" Leaf Components ('use client' or RSC)            |
|   - Pure rendering logic only                             |
|   - No data fetching, direct SQL, or complex math         |
+-----------------------------------------------------------+
                             ^
                             | (Props & ViewState)
+-----------------------------------------------------------+
|                     Model / Controller                    |
|   Server Actions / Route Handlers / Domain Hooks          |
|   - Business calculations                                 |
|   - Drizzle / Database mutations                          |
|   - External API calls and authentication guards          |
+-----------------------------------------------------------+
```

---

## 2. Type-Safe Server Action Helper

To prevent unhandled exceptions and eliminate boilerplate, wrap all Server Actions in a typed executor that validates input via Zod and enforces authentication:

```typescript
import { z } from 'zod';

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export function createServerAction<TInput, TOutput>(opts: {
  inputSchema: z.ZodSchema<TInput>;
  handler: (input: TInput, ctx: { userId: string }) => Promise<TOutput>;
}) {
  return async (rawInput: unknown): Promise<ActionResponse<TOutput>> => {
    try {
      // 1. Authenticate user
      const session = await getAuthSession();
      if (!session?.userId) {
        return { success: false, error: 'Unauthorized: Session required' };
      }

      // 2. Validate input with Zod
      const parseResult = opts.inputSchema.safeParse(rawInput);
      if (!parseResult.success) {
        return {
          success: false,
          error: 'Validation failed',
          fieldErrors: parseResult.error.flatten().fieldErrors,
        };
      }

      // 3. Execute business logic
      const result = await opts.handler(parseResult.data, { userId: session.userId });
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return { success: false, error: message };
    }
  };
}
```

---

## 3. Server Component Leaf Boundary Rule

Only add `'use client'` at the lowest possible leaf component requiring user event listeners or local transient state:

```tsx
// app/elections/[id]/page.tsx (React Server Component - Model)
import { getElectionDetails } from '@/lib/db/queries';
import { ElectionHeaderView } from './ElectionHeaderView'; // View
import { VoteSubmissionForm } from './VoteSubmissionForm'; // 'use client' View

export default async function ElectionPage({ params }: { params: { id: string } }) {
  const election = await getElectionDetails(params.id);

  return (
    <main className="container mx-auto p-6 space-y-6">
      <ElectionHeaderView election={election} />
      <VoteSubmissionForm electionId={election.id} candidates={election.candidates} />
    </main>
  );
}
```
