import { pgTable, text, timestamp, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Enterprise multi-tenant Drizzle ORM schema with relations.
 * Inspired by `midday-ai/midday` and `openstatusHQ/openstatus`.
 */

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  ...timestamps,
});

export const elections = pgTable('elections', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .references(() => organizations.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  ...timestamps,
});

export const ballots = pgTable('ballots', {
  id: uuid('id').defaultRandom().primaryKey(),
  electionId: uuid('election_id')
    .references(() => elections.id, { onDelete: 'cascade' })
    .notNull(),
  ballotHash: text('ballot_hash').unique().notNull(),
  voterAge: text('voter_age').notNull(),
  ...timestamps,
});

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  elections: many(elections),
}));

export const electionsRelations = relations(elections, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [elections.orgId],
    references: [organizations.id],
  }),
  ballots: many(ballots),
}));
