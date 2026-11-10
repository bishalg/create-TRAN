// Verifies: REQ-SCR-008
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  CONTRACT_PATH,
  ROLES,
  STRINGS_PATH,
  checkManifest,
  detectScreen,
  forPlatform,
  indexContract,
  neverObserved,
  resolve,
  run,
} from './screens-check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const contract = indexContract(JSON.parse(readFileSync(join(ROOT, CONTRACT_PATH), 'utf8')));
const strings = JSON.parse(readFileSync(join(ROOT, STRINGS_PATH), 'utf8'));
const UNIT = { web: 'css_px', ios: 'pt', android: 'dp' };
const NAMED = new Set(['field', 'button', 'segmented', 'progress', 'dialog']);

/** A node exactly as the contract wants it on `platform`: its role, its name, a roomy frame. */
function node(platform, element, locale = 'en') {
  const label = resolve(strings, element.label, locale);
  return {
    id: element.id,
    role: ROLES[platform][element.kind][0],
    name: label,
    ...(NAMED.has(element.kind) ? {} : { value: 'some content' }),
    interactive: element.touch !== 'none',
    frame: { x: 0, y: 0, width: 100, height: 100 },
    unit: UNIT[platform],
  };
}

/**
 * A manifest every rule accepts: per screen the platform offers, one snapshot of its always-present
 * elements, then one per conditional state (a dialog state alone, as platforms show it).
 */
function passing(platform) {
  const snapshots = [];
  for (const screen of forPlatform(contract, platform).screens) {
    const always = screen.elements.filter((e) => e.presence === 'always');
    if (always.length === 0) continue;
    const scenario = `staged ${screen.id}`;
    const base = () => always.map((e) => node(platform, e));
    snapshots.push({ platform, scenario, phase: 'given', elements: base() });
    const states = new Set(
      screen.elements.filter((e) => e.presence === 'when').map((e) => e.state)
    );
    for (const state of states) {
      if (contract.unreached.has(state)) continue;
      const extra = screen.elements.filter((e) => e.state === state).map((e) => node(platform, e));
      const modal = state.endsWith('_confirm');
      snapshots.push({
        platform,
        scenario,
        phase: state,
        elements: modal ? extra : [...base(), ...extra],
      });
    }
  }
  return { platform, snapshots };
}

/** The differences `manifest` has, rules and elements only, sorted. */
function differences(manifest) {
  const { failures, seen } = checkManifest(contract, strings, manifest);
  const { missing } = neverObserved(contract, seen, manifest.platform);
  return [...failures, ...missing].map((f) => `${f.element} ${f.rule}`).sort();
}

/** `passing(platform)` with `change` applied to the first snapshot of `screen`. */
function staged(platform, screen, change) {
  const manifest = passing(platform);
  const snapshot = manifest.snapshots.find((s) => s.scenario === `staged ${screen}`);
  change(snapshot);
  return manifest;
}

const byId = (snapshot, id) => snapshot.elements.find((n) => n.id === id);

describe('a staged manifest that matches the contract', () => {
  for (const platform of ['web', 'ios', 'android']) {
    it(`passes on ${platform}`, () => {
      assert.deepEqual(differences(passing(platform)), []);
    });
  }

  it('lists an unreached state instead of failing it', () => {
    const { seen } = checkManifest(contract, strings, passing('web'));
    const { missing, notes } = neverObserved(contract, seen, 'web');
    assert.deepEqual(missing, []);
    assert.ok(notes.some((note) => note.includes('toast') && note.includes('unreached')));
  });
});

describe('each failure class', () => {
  it('reports a required element that is absent', () => {
    const manifest = staged('web', 'eligibility', (s) => {
      s.elements = s.elements.filter((n) => n.id !== 'age-field');
    });
    assert.deepEqual(differences(manifest), ['age-field required present']);
  });

  it('reports a role the kind does not allow on the platform', () => {
    const manifest = staged('ios', 'eligibility', (s) => {
      byId(s, 'age-field').role = 'staticText';
    });
    assert.deepEqual(differences(manifest), ['age-field role']);
  });

  it('reports a name other than the resolved label, and content that does not name its label', () => {
    const manifest = staged('android', 'eligibility', (s) => {
      byId(s, 'check-button').name = 'Go';
      byId(s, 'offline-result').name = '';
      byId(s, 'offline-result').value = 'Age 20 meets the minimum voting age of 18 in NP.';
    });
    assert.deepEqual(differences(manifest), ['check-button name', 'offline-result name']);
  });

  it('accepts content whose name or value contains the label, in the snapshot locale', () => {
    const manifest = staged('web', 'eligibility', (s) => {
      s.locale = 'ne';
      for (const n of s.elements) {
        const element = contract.elements.get(n.id);
        n.name = resolve(strings, element.label, 'ne');
      }
      byId(s, 'api-status').name = '';
      byId(s, 'api-status').value = `${resolve(strings, 'shell.status.label', 'ne')}: online`;
    });
    assert.deepEqual(differences(manifest), []);
  });

  it('reports a control below its platform minimum, read from the contract', () => {
    const web = contract.minimums.find((m) => m.platform === 'web');
    const manifest = staged('web', 'eligibility', (s) => {
      byId(s, 'check-button').frame.height = web.primary_action - 1; // primary
      byId(s, 'age-field').frame.width = web.control - 0.001; // within rounding
      byId(s, 'sign-out-button').unit = 'pt';
    });
    assert.deepEqual(differences(manifest), ['check-button touch minimum', 'sign-out-button unit']);
  });

  it('reports an interactive node the contract does not declare on the platform', () => {
    const manifest = staged('ios', 'eligibility', (s) => {
      const button = { role: 'button', name: 'Share', interactive: true, frame: {}, unit: 'pt' };
      s.elements.push(button, { ...button, id: 'share-button' });
      // The web's own skip link is not iOS's.
      s.elements.push({ ...node('web', contract.elements.get('skip-link')), unit: 'pt' });
    });
    assert.deepEqual(differences(manifest), [
      'button "Share" undeclared interactive',
      'share-button undeclared interactive',
      'skip-link undeclared interactive',
    ]);
  });

  it('accepts options of a declared segmented control, the platform keyboard and decorative ids', () => {
    const manifest = staged('ios', 'eligibility', (s) => {
      const option = { role: 'button', name: 'Dark', interactive: true, unit: 'pt' };
      s.elements.push(
        { ...option, id: 'theme-picker-dark', frame: { width: 44, height: 44 } },
        { ...option, within: 'theme-picker', frame: { width: 44, height: 44 } },
        { role: 'key', name: 'q', interactive: true, frame: {}, unit: 'pt' },
        { role: 'button', name: 'THE', interactive: true, within: 'SystemInputAssistantView' },
        { id: 'wifi.exclamationmark', role: 'image', name: 'Wi-Fi', interactive: false }
      );
    });
    assert.deepEqual(differences(manifest), []);
  });

  it('sizes a segmented control option by its control', () => {
    const manifest = staged('android', 'eligibility', (s) => {
      s.elements.push({
        id: 'theme-picker-dark',
        role: 'Checkbox',
        name: 'Dark',
        interactive: true,
        frame: { width: 47, height: 48 },
        unit: 'dp',
      });
    });
    assert.deepEqual(differences(manifest), ['theme-picker-dark touch minimum']);
  });

  it('reports a conditional element no snapshot shows', () => {
    const manifest = passing('web');
    manifest.snapshots = manifest.snapshots.filter((s) => s.phase !== 'validation_failed');
    assert.deepEqual(differences(manifest), ['validation-message never observed']);
  });

  it('reports every difference of a run, not the first', () => {
    const manifest = staged('web', 'eligibility', (s) => {
      s.elements = s.elements.filter((n) => n.id !== 'age-field' && n.id !== 'check-button');
    });
    assert.equal(differences(manifest).length, 2);
  });

  it('reports a manifest of an unknown platform', () => {
    assert.deepEqual(differences({ platform: 'tv', snapshots: [] }), ['- platform']);
  });
});

describe('detectScreen', () => {
  const ios = forPlatform(contract, 'ios');
  const snapshot = (...ids) => ({ elements: ids.map((id) => ({ id })) });
  const screen = (id) => ios.screens.find((s) => s.id === id);

  it('picks the screen whose always-present ids overlap most', () => {
    const detected = detectScreen(ios, snapshot('sign-out-button', 'role-badge', 'age-field'));
    assert.equal(detected.screen.id, 'eligibility');
  });

  it('breaks a tie by the fewest always-present elements missing', () => {
    // The auditor's elements are a subset of the dashboard's: both overlap twice.
    assert.equal(detectScreen(ios, snapshot('sign-out-button', 'role-badge')).screen.id, 'auditor');
  });

  it('reports a tie it cannot break, and a snapshot that matches nothing', () => {
    const twin = { ...screen('auditor'), id: 'auditor_twin' };
    const tied = detectScreen(
      { screens: [screen('auditor'), twin] },
      snapshot('sign-out-button', 'role-badge')
    );
    assert.match(tied.error, /ambiguous/);
    assert.match(detectScreen(ios, snapshot('unknown')).error, /no contract screen/);
    assert.match(detectScreen(ios, snapshot()).error, /no contract screen/);
  });

  it('gives a modal state the screen beneath it, when that screen declares what it shows', () => {
    const dialog = snapshot('dialog-confirm', 'dialog-cancel');
    const beneath = detectScreen(ios, dialog, screen('auditor'));
    assert.deepEqual([beneath.screen.id, beneath.modal], ['auditor', true]);
    assert.match(detectScreen(ios, dialog).error, /no contract screen/);
    assert.match(detectScreen(ios, snapshot('toast'), screen('auditor')).error, /no contract/);
  });
});

describe('resolve', () => {
  it('falls back to English for a key a locale lacks', () => {
    assert.equal(resolve({ en: { k: 'Hello' }, ne: {} }, 'k', 'ne'), 'Hello');
    assert.equal(resolve(strings, 'common.signOut'), 'Sign out');
  });
});

describe('run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tran-screens-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a missing platform as "no manifest" without failing', () => {
    const { lines, ok } = run(ROOT, dir);
    assert.equal(ok, true);
    assert.equal(lines.filter((line) => line.includes('no manifest')).length, 3);
  });

  it('fails a manifest with a difference and prints one line per difference and per platform', () => {
    const manifest = staged('web', 'eligibility', (s) => {
      byId(s, 'age-field').role = 'button';
    });
    writeFileSync(join(dir, 'web.json'), JSON.stringify(manifest));
    const { lines, ok } = run(ROOT, dir);
    assert.equal(ok, false);
    assert.ok(
      lines.some((line) =>
        /✗ .*web\.json › staged eligibility \[given\] › age-field › role/.test(line)
      )
    );
    assert.ok(
      lines.includes(`screens-check: web: ${manifest.snapshots.length} snapshots, 1 difference`)
    );
    assert.ok(lines.some((line) => line.startsWith('screens-check: ios: no manifest')));
  });
});
