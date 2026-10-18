# Drizzle ORM & Database Architecture Guide

This guide establishes the database schema and query architecture for enterprise TypeScript monorepos, based on **Midday (`packages/db`)** and **OpenStatus (`packages/db`)**.

---

## 1. Schema Organization & Multi-Tenancy

Always enforce multi-tenant separation (`teamId` or `organizationId`) and audit timestamps on all entity tables:

```typescript
import { pgTable, text, timestamp, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  ...timestamps,
});

export const elections = pgTable('elections', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  ...timestamps,
});

export const electionsRelations = relations(elections, ({ one }) => ({
  team: one(teams, {
    fields: [elections.teamId],
    references: [teams.id],
  }),
}));
```

---

## 2. Row-Level Security (RLS) with Supabase / Postgres

When using Supabase or direct Postgres with Drizzle, ensure tenant isolation is guaranteed at the database engine level via RLS:

```sql
-- Enable RLS on elections
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;

-- Allow team members to view only their team's elections
CREATE POLICY "Team members can view team elections" ON elections
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );
```

---

## 3. Safe Mutation Queries

Never write raw string queries or un-scoped updates. Always include the tenant ID in the WHERE clause:

```typescript
export async function updateElection(
  db: Database,
  teamId: string,
  electionId: string,
  data: Partial<typeof elections.$inferInsert>
) {
  return db
    .update(elections)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(elections.id, electionId), eq(elections.teamId, teamId)))
    .returning();
}
```
