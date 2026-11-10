// Verifies: REQ-DB-005 REQ-DB-010
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  breakingChanges,
  checkMigration,
  compareDocs,
  compareReleased,
  documentedColumns,
  schemaColumns,
  statements,
  stripComments,
} from './migrations.mjs';

const SCRIPT = fileURLToPath(new URL('./migrations.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('reading SQL', () => {
  it('drops comments but keeps quoted text', () => {
    assert.equal(stripComments("a -- note\nb /* x\ny */ c '--kept'"), "a \nb  c '--kept'");
    assert.equal(stripComments('a /* never closed'), 'a ');
    assert.equal(stripComments("'open"), "'open");
    assert.equal(stripComments('x -- to the end'), 'x ');
    assert.deepEqual(statements('CREATE  TABLE t (a);\n-- DROP TABLE t;\n ;'), ['CREATE TABLE t (a)']);
  });
});

describe('breakingChanges (REQ-DB-005)', () => {
  it('allows what the previous release can live with', () => {
    const expand = `
      CREATE TABLE pets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE UNIQUE INDEX pets_by_name ON pets (name);
      CREATE INDEX sessions_by_role ON sessions (role);
      ALTER TABLE sessions ADD COLUMN label TEXT;
      ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web';
      -- DROP TABLE sessions; is only a comment
    `;
    assert.deepEqual(breakingChanges(expand), []);
  });

  it('names every destructive or tightening statement', () => {
    const contract = `
      DROP TABLE old_sessions;
      DROP VIEW IF EXISTS "summary";
      ALTER TABLE sessions DROP COLUMN label;
      ALTER TABLE sessions RENAME TO logins;
      ALTER TABLE sessions RENAME COLUMN role TO kind;
      ALTER TABLE sessions RENAME transport TO via;
      ALTER TABLE sessions ADD COLUMN tier TEXT NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS one_per_user ON sessions (user_id);
    `;
    assert.deepEqual(breakingChanges(contract), [
      'drops table old_sessions',
      'drops table summary',
      'drops column sessions.label',
      'renames table sessions to logins',
      'renames column sessions.role to kind',
      'renames column sessions.transport to via',
      'adds NOT NULL column sessions.tier without a default',
      'tightens a constraint: unique index one_per_user on existing table sessions',
    ]);
  });
});

describe('checkMigration (REQ-DB-005)', () => {
  const drop = 'ALTER TABLE sessions DROP COLUMN label;';

  it('fails a breaking migration without a contract line, naming the file', () => {
    const [problem] = checkMigration('0002_drop_label.sql', drop);
    assert.match(problem, /^0002_drop_label\.sql: drops column sessions\.label; expand first/);
  });

  it('passes one whose contract line names a reason and a release', () => {
    const marked = `-- contract: v1.4.0 stopped reading label; nothing writes it since v1.3\n${drop}`;
    assert.deepEqual(checkMigration('0002_drop_label.sql', marked), []);
    assert.deepEqual(checkMigration('0003_add.sql', 'ALTER TABLE s ADD COLUMN x TEXT;'), []);
  });

  it('fails a contract line that names no release', () => {
    const [problem] = checkMigration('0002_drop_label.sql', `-- contract: not needed\n${drop}`);
    assert.match(problem, /must name the release/);
  });
});

describe('compareReleased (REQ-DB-005)', () => {
  it('fails a released migration that was changed or removed, and allows a new one', () => {
    const base = { '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (x);' };
    const tree = { '0001_a.sql': 'CREATE TABLE a (y);', '0003_c.sql': 'CREATE TABLE c (x);' };
    assert.deepEqual(compareReleased(base, tree), [
      '0001_a.sql: released migration was changed; fix forward instead',
      '0002_b.sql: released migration was removed; fix forward instead',
    ]);
    assert.deepEqual(compareReleased(base, { ...base }), []);
  });
});

const SCHEMA = `-- header
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('a', 'b')),
    PRIMARY KEY (id),
    UNIQUE (user_id, role)
);

CREATE INDEX sessions_by_user ON sessions (user_id);
`;

const DOC = `# Playbook

## What is stored

| Table      | Column    | Purpose      | Kept until   |
| :--------- | :-------- | :----------- | :----------- |
| \`sessions\` | \`id\`      | names it     | it ends      |
| sessions   | user_id   | whose        | it ends      |
| sessions   | gone      | was          | never        |
| sessions   | role      |              | it ends      |

## Where it lives

| Part | Place |
| :--- | :---- |
| x    | y     |
`;

describe('every stored column is documented (REQ-DB-010)', () => {
  it('reads the columns of each table, not its constraints', () => {
    assert.deepEqual(schemaColumns(SCHEMA), { sessions: ['id', 'user_id', 'role'] });
  });

  it('reads only the What is stored table', () => {
    assert.deepEqual(
      documentedColumns(DOC).map((row) => `${row.table}.${row.column}`),
      ['sessions.id', 'sessions.user_id', 'sessions.gone', 'sessions.role']
    );
    assert.deepEqual(documentedColumns('# nothing here'), []);
  });

  it('fails an undocumented column, a documented one that is gone, and a row with no purpose', () => {
    const tables = { ...schemaColumns(SCHEMA), devices: ['token'] };
    assert.deepEqual(compareDocs(tables, documentedColumns(DOC)), [
      'devices.token is in apps/api/schema.sql but not listed in "What is stored" (docs/PERSISTENCE.md)',
      'sessions.gone is listed in docs/PERSISTENCE.md but not in apps/api/schema.sql',
      'sessions.role: give its purpose and how long it is kept (docs/PERSISTENCE.md)',
    ]);
  });

  it('holds for the committed schema and playbook', () => {
    const read = (path) => readFileSync(`${ROOT}/${path}`, 'utf8');
    const problems = compareDocs(
      schemaColumns(read('apps/api/schema.sql')),
      documentedColumns(read('docs/PERSISTENCE.md'))
    );
    assert.deepEqual(problems, []);
  });
});

describe('the command', () => {
  it('passes on this repository and says what it compared', () => {
    const run = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /migrations: \d+ migration\(s\) expand-only, every stored column documented/);
  });

  it('compares with a base that has no migrations', () => {
    const run = spawnSync('node', [SCRIPT, '--base', 'HEAD~100000'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /HEAD~100000 has no migrations, so none is released yet/);
  });
});
