// Verifies: REQ-CI-001
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../.github/workflows/native-tests.yml'),
  'utf8'
);

describe('native-tests workflow', () => {
  it('runs on a schedule and on dispatch, never on pull requests', () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).toContain("cron: '17 4 * * *'");
    expect(workflow).not.toMatch(/^ {2}pull_request:/m);
  });

  it('keeps Maestro dispatch-only and the tracking issue schedule-only', () => {
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.maestro");
    expect(workflow).toContain("if: github.event_name == 'schedule'");
    expect(workflow).toContain('needs: [ios, android]');
    expect(workflow).toContain('Nightly native tests are failing');
    expect(workflow).toContain("state: 'closed'");
  });

  it('pins every action to a commit SHA', () => {
    const refs = [...workflow.matchAll(/^ {6}- uses: (\S+)/gm)].map(([, ref]) => ref ?? '');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it('gives every job a timeout and the suites failure artifacts', () => {
    for (const job of ['ios', 'android', 'maestro', 'notify']) {
      expect(workflow).toMatch(new RegExp(`^ {2}${job}:$`, 'm'));
    }
    expect(workflow.match(/^ {4}timeout-minutes: \d+$/gm) ?? []).toHaveLength(4);
    expect(workflow.match(/uses: actions\/upload-artifact@/g) ?? []).toHaveLength(3);
    expect(workflow.match(/if: failure\(\)/g) ?? []).toHaveLength(3);
  });
});
