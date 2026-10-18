---
name: web-production
description: >-
  Enterprise-grade Next.js App Router, TanStack, and Turborepo/Nx monorepo production engineering standard.
  Based on Midday, OpenStatus, Dub, Cal.com, Documenso, and TanStack Start.
  Use this skill whenever writing, reviewing, architecting, refactoring, or testing web apps, Server Actions,
  Drizzle schemas, TanStack Table/Query, or Playwright BDD tests.
---

# Web & Full-Stack Production Engineering Skill

A comprehensive production engineering manual and code template system for modern Next.js (App Router, Server Actions, React Server Components) and TanStack full-stack applications in 2026. This skill synthesizes architectural standards, security primitives, and testing patterns from the top open-source revenue-generating SaaS codebases:

1. **Midday (`midday-ai/midday`)**: Turborepo, Next.js App Router, shadcn/ui, TanStack Table, Drizzle ORM, Supabase RLS, and background job pipelines.
2. **OpenStatus (`openstatusHQ/openstatus`)**: Next.js + Hono + tRPC, Drizzle ORM schema patterns, and URL-state-synced (`nuqs`) filtering with TanStack Table.
3. **Dub (`dubinc/dub`)**: High-scale edge utilities (`packages/utils`), zero-dependency fetchers, Zod API validation, rate limiting, and webhook signatures.
4. **Cal.com (`calcom/cal.com`)**: Enterprise Turborepo monorepo, complex timezone/date manipulation, structured logging, and comprehensive Playwright E2E BDD tests.
5. **Documenso (`documenso/documenso`)**: Strict monorepo package boundaries (`packages/trpc`, `packages/lib`, `packages/email`), Playwright tests, and TanStack Query.
6. **TanStack Start (`tanstack/router`)**: Pure TanStack full-stack architecture with type-safe server functions (`createServerFn`), file-based routing, and Better Auth guards.

---

## Quick Reference & Utility Map

| Architecture / Feature | Benchmark Repository | Reference Guide | Copy-Ready Implementation |
| :--- | :--- | :--- | :--- |
| **Strict MVC & Server Actions** | Midday / Cal.com | [App Router & Server Actions](./references/app_router_and_server_actions.md) | [serverActionHelper.ts](./examples/serverActionHelper.ts) |
| **URL-Synced TanStack Table (`nuqs`)** | OpenStatus (`apps/web`) | [TanStack Table & nuqs](./references/tanstack_table_and_nuqs.md) | [dataTableHelper.tsx](./examples/dataTableHelper.tsx) |
| **Zero-Dependency Edge Utils & Zod** | Dub (`packages/utils`) | [Edge Utilities & Zod](./references/edge_utilities_and_zod.md) | [edgeUtils.ts](./examples/edgeUtils.ts) |
| **Drizzle Multi-Tenant Schemas** | Midday / OpenStatus | [Drizzle & DB Architecture](./references/drizzle_and_db_architecture.md) | [drizzleSchema.ts](./examples/drizzleSchema.ts) |
| **Playwright BDD & Page Objects** | Cal.com (`apps/web/playwright`) | [Playwright BDD Testing](./references/playwright_bdd_testing.md) | [playwrightPageFixture.ts](./examples/playwrightPageFixture.ts) |

---

## Core Production Principles

Every line of TypeScript, React, and Next.js code written or reviewed must adhere to these 6 principles:

### 1. Strict MVC & React Server Components (RSC)
- **Rule**: Follow Strict MVC separation:
  - **View (`.tsx`)**: "Dumb" components with rendering logic only. Zero direct database queries, complex math, or data fetching.
  - **Model/Controller**: Data mutations, external APIs, and business logic belong exclusively inside Server Actions, Route Handlers, or custom hooks.
- **Rule**: Default to React Server Components (RSC). Only add `'use client'` at the lowest possible leaf component when interactivity (state, event listeners) is required.

### 2. Type-Safe Server Actions with Zod Validation
- **Rule**: Never trust client inputs. Every Server Action must validate its payload through a Zod schema before processing.
- **Rule**: Return standardized result envelopes (`{ success: true, data: T } | { success: false, error: string }`).

### 3. URL-Synchronized State with `nuqs`
- **Rule**: For filters, pagination, sorting, and search inputs in data tables or dashboards, sync state directly into URL search parameters using `nuqs`.
- **Rule**: This ensures shareable URLs, instant browser history navigation, and zero state desynchronization.

### 4. Zero-Dependency Edge Utilities
- **Rule**: Core utilities (`packages/utils`) must be runtime-agnostic and work seamlessly on Vercel Edge, Cloudflare Workers, Node.js, and browser environments.
- **Rule**: Avoid pulling heavy libraries for simple tasks (use native `Intl` for formatting, native `crypto.subtle` for hashing).

### 5. Multi-Tenant Database Isolation
- **Rule**: Drizzle ORM schemas must enforce tenant/user isolation (`organizationId`, `userId`) and row-level security (RLS) on all mutating queries.
- **Rule**: Never use mock data in production code paths.

### 6. Playwright BDD & Robot Testing
- **Rule**: Structure E2E tests using Page Object Models and step fixtures (`test.step(...)`) to represent human-readable user journeys.
- **Rule**: Isolate test runs using deterministic database seeding and isolated storage states.
