// Verifies: REQ-API-011 REQ-VER-002
/**
 * Every real answer the router gave (`fixtures/contract/v1/responses.json`, written by
 * `apps/api/tests/contract_test.rs`) parses with the schemas the clients read it with, and the
 * request schemas name the fields this client sends.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoteEligibilityInputSchema } from '../src/schemas/vote.js';
import { schemaFor, SUCCESS_SCHEMAS } from './helpers/routes.js';

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/contract/v1/${name}`, import.meta.url), 'utf8')
  );

interface Snapshot {
  case: string;
  route: string;
  status: number;
  body: unknown;
}

const responses: Snapshot[] = read('responses.json');
const routes: string[] = read('routes.json');
const requests: Record<string, Record<string, { type: string; required: boolean }>> = read(
  'requests.json'
);

describe('contract snapshots parse with the client schemas (REQ-API-011)', () => {
  it.each(responses)('[REQ-API-011] $route $status: $case', (snapshot) => {
    const schema = schemaFor(snapshot.route, snapshot.status);
    if (schema === null) expect(snapshot.body).toBeNull();
    else expect(schema.safeParse(snapshot.body).error).toBeUndefined();
  });

  it('[REQ-API-011] every route the clients read has a schema and a snapshot', () => {
    for (const route of Object.keys(SUCCESS_SCHEMAS)) {
      expect(routes).toContain(route);
      expect(responses.some((r) => r.route === route && r.status < 300)).toBe(true);
    }
  });

  it('[REQ-VER-002] the eligibility request schema matches the one the web sends', () => {
    const fields = requests['POST /api/v1/vote/eligibility']!;
    const shape = VoteEligibilityInputSchema.shape;
    expect(Object.keys(fields).sort()).toEqual(Object.keys(shape).sort());
    for (const [name, spec] of Object.entries(fields)) {
      expect(shape[name as keyof typeof shape].safeParse(undefined).success).toBe(!spec.required);
    }
  });
});
