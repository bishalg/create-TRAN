// Verifies: REQ-WEB-008 REQ-I18N-004 REQ-I18N-005 REQ-I18N-006 REQ-I18N-007 REQ-LOAD-001
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOGUE,
  ERROR_CATALOGUE,
  LOADING_POLICY,
  VERDICT_SOURCES,
} from '../src/generated/feedback.js';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const localesDir = path.join(root, 'locales');

const MODULES = readdirSync(path.join(localesDir, 'en'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

function readText(...segments: string[]): string {
  return readFileSync(path.join(root, ...segments), 'utf8');
}

function listFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated' && entry.name !== 'node_modules') {
        files.push(...listFiles(full, extensions));
      }
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(full);
    }
  }
  return files;
}

const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');

/** Every key defined in `locales/<locale>/*.json`, as `<module>.<path>`. */
function translationKeys(): Set<string> {
  const keys = new Set<string>();
  for (const module of MODULES) {
    const raw: unknown = JSON.parse(readText('locales', 'en', `${module}.json`));
    flatten(raw, module, keys);
  }
  return keys;
}

function flatten(value: unknown, prefix: string, out: Set<string>): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, `${prefix}.${key}`, out);
    }
    return;
  }
  out.add(prefix);
}

const KEYS = translationKeys();

/** `theme.light` → `themeLight`, mirroring the generated accessor naming rule. */
function memberName(key: string): string {
  return key
    .split('.')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function androidResourceName(key: string): string {
  return key.replaceAll('.', '_').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

interface Allowance {
  file: string;
  text: string;
  reason: string;
}

/** Only decorative, non-translatable glyphs belong here — each needs a written reason. */
const LITERAL_ALLOWLIST: Allowance[] = [
  {
    file: 'apps/web/src/app/Header.tsx',
    text: 'T',
    reason: 'brand-mark glyph, aria-hidden decoration — not translatable copy',
  },
];

function allowed(file: string, text: string): boolean {
  return LITERAL_ALLOWLIST.some((entry) => entry.file === file && entry.text === text);
}

/** User-visible JSX text and copy attributes, found with the TypeScript parser. */
function jsxLiterals(source: string, file: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (/[A-Za-z]/.test(text)) found.push(text);
    }
    if (
      ts.isJsxAttribute(node) &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer) &&
      ['aria-label', 'placeholder', 'title', 'alt'].includes(node.name.getText(parsed)) &&
      /[A-Za-z]/.test(node.initializer.text)
    ) {
      found.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function collectViolations(): { file: string; text: string }[] {
  const violations: { file: string; text: string }[] = [];

  for (const file of listFiles(path.join(root, 'apps/web/src'), ['.tsx'])) {
    if (file.includes('.test.')) continue;
    for (const text of jsxLiterals(readFileSync(file, 'utf8'), file)) {
      if (!allowed(relative(file), text)) violations.push({ file: relative(file), text });
    }
  }

  const swiftCalls =
    /\b(?:Text|Button|Picker|Label|TextField)\(\s*"([^"\\]*)"|NSLocalizedString\(\s*"([^"\\]*)"|\.accessibility(?:Label|Value)\(\s*(?:Text\()?"([^"\\]*)"/g;
  for (const file of listFiles(path.join(root, 'apps/ios/Sources/TranVotingDemo'), ['.swift'])) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(swiftCalls)) {
      const text = match[1] ?? match[2] ?? match[3] ?? '';
      if (text !== '' && !allowed(relative(file), text))
        violations.push({ file: relative(file), text });
    }
  }

  const kotlinCalls = /\bText\(\s*"([^"\\]*)"|contentDescription\s*=\s*"([^"\\]*)"/g;
  for (const file of listFiles(path.join(root, 'apps/android/app/src/main/kotlin'), ['.kt'])) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(kotlinCalls)) {
      const text = match[1] ?? match[2] ?? '';
      if (text !== '' && !allowed(relative(file), text))
        violations.push({ file: relative(file), text });
    }
  }

  const manifest = readText('apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  for (const match of manifest.matchAll(/android:label="([^"@]*[A-Za-z][^"]*)"/g)) {
    violations.push({ file: 'AndroidManifest.xml', text: match[1]! });
  }

  return violations;
}

/** Keys referenced by at least one consumer: TS literals, Swift/Kotlin accessors, manifest. */
function usedKeys(): Set<string> {
  const used = new Set<string>();

  for (const file of [...listFiles(path.join(root, 'apps/web/src'), ['.ts', '.tsx'])]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)['"`]/g)) {
      if (KEYS.has(match[1]!)) used.add(match[1]!);
    }
  }

  const swiftViews = listFiles(path.join(root, 'apps/ios/Sources/TranVotingDemo'), ['.swift'])
    .filter((file) => !file.includes('/Generated/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const themeModes = (
    JSON.parse(readText('packages', 'core-ts', 'src', 'generated', 'tokens.json')) as {
      themes: { mode: string }[];
    }
  ).themes.map((theme) => theme.mode);

  const kotlinViews = listFiles(path.join(root, 'apps/android/app/src/main/kotlin'), ['.kt'])
    .filter((file) => !file.includes('/generated/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const manifest = readText('apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const manifestResources = new Set(
    [...manifest.matchAll(/@string\/(\w+)/g)].map((match) => match[1]!)
  );

  for (const key of KEYS) {
    const [module, ...rest] = key.split('.');
    const accessor = memberName(rest.join('.'));
    if (swiftViews.includes(`L10n.${pascal(module!)}.${accessor}`)) used.add(key);
    if (kotlinViews.includes(`TranStrings.${pascal(module!)}.${accessor}`)) used.add(key);
    if (manifestResources.has(androidResourceName(key))) used.add(key);
  }

  // Theme labels are consumed through the generated `TranTheme` label mappings.
  if (swiftViews.includes('.label') || kotlinViews.includes('labelRes')) {
    for (const mode of themeModes) used.add(`shell.theme.${mode}`);
  }

  // Feedback copy is looked up by code at runtime through the Rust catalogue (ADR-0028).
  for (const spec of [...ERROR_CATALOGUE, ...ACTION_CATALOGUE]) used.add(spec.messageKey);

  // The waiting policy names its copy the same way (ADR-0035, REQ-LOAD-001).
  used.add(LOADING_POLICY.pendingMessageKey);
  for (const spec of VERDICT_SOURCES) used.add(spec.messageKey);

  return used;
}

describe('user-visible copy comes from locales/', () => {
  it('has no hardcoded literals in web, iOS, Android or the manifest', () => {
    const violations = collectViolations();
    const report = violations
      .map((violation) => `${violation.file}: "${violation.text}"`)
      .join('\n');
    expect(report, 'add a dictionary key (and run `pnpm i18n:sync`) or allowlist decor').toBe('');
  });

  it('keeps the static HTML shell in sync with the English dictionary', () => {
    const html = readText('apps', 'web', 'index.html');
    const english = JSON.parse(readText('locales', 'en', 'shell.json')) as {
      title: string;
      subtitle: string;
    };
    const brand = (JSON.parse(readText('locales', 'en', 'common.json')) as { brand: string }).brand;
    expect(html).toContain(`<title>${english.title} · ${brand}</title>`);
    expect(html).toMatch(
      new RegExp(`name="description"\\s*\\n?\\s*content="${escapeRegExp(english.subtitle)}"`)
    );
  });

  it('references every dictionary key from a consumer (no dead keys)', () => {
    const used = usedKeys();
    const unused = [...KEYS].filter((key) => !used.has(key)).sort();
    expect(
      unused,
      'remove these from locales/ or reference them (web `t()`, iOS L10n, Android TranStrings)'
    ).toEqual([]);
  });

  it('never displays the core-supplied English `reason` or validation `detail`', () => {
    const sources = [
      ...listFiles(path.join(root, 'apps/web/src'), ['.tsx', '.ts']).filter(
        (file) => !/\.test\.tsx?$/.test(file)
      ),
      ...listFiles(path.join(root, 'apps/ios/Sources/TranVotingDemo'), ['.swift']),
      ...listFiles(path.join(root, 'apps/android/app/src/main/kotlin'), ['.kt']),
    ].filter((file) => !/\/(Generated|generated|uniffi)\//.test(file));
    const offenders = sources
      .filter((file) => /\.reason\b|\breason:\s|\.detail\b/.test(readText(relative(file))))
      .map(relative);

    expect(
      offenders,
      'build the sentence from facts with eligibility.result.reasonMeets/Below'
    ).toEqual([]);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
