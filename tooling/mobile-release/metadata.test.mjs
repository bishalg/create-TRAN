// Verifies: REQ-MOB-011
// The store listing text `pnpm tokens:sync` writes for fastlane: every mapped locale has every file
// on both stores, every field fits its store limit, the release notes are the current version's
// CHANGELOG section and the addresses are the configured ones. Node built-ins only.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildNumber, notesFor } from '../release/release.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IOS = join(ROOT, 'apps/ios/fastlane/metadata');
const ANDROID = join(ROOT, 'apps/android/fastlane/metadata/android');

const read = (...segments) => readFileSync(join(...segments), 'utf8');
const json = (...segments) => JSON.parse(read(...segments));
const folders = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()) : [];
const length = (text) => [...text].length;

const config = json(ROOT, 'tooling/mobile-release/store-listing.json');
const LOCALES = folders(join(ROOT, 'locales')).sort();

/** File → limit in characters. App Store Connect Help ("Platform version information"). */
const APP_STORE_LIMITS = {
  'name.txt': 30,
  'subtitle.txt': 30,
  'description.txt': 4000,
  'keywords.txt': 100,
  'promotional_text.txt': 170,
  'release_notes.txt': 4000,
};
/** The addresses `deliver` uploads with each App Store language. */
const APP_STORE_URLS = {
  'support_url.txt': 'supportUrl',
  'marketing_url.txt': 'marketingUrl',
  'privacy_url.txt': 'privacyPolicyUrl',
};
/** File → limit in characters. Play Console Help (store listing). */
const PLAY_LIMITS = { 'title.txt': 30, 'short_description.txt': 80, 'full_description.txt': 4000 };
const PLAY_CHANGELOG_LIMIT = 500;

const version = json(ROOT, 'package.json').version;
const changelog = read(ROOT, 'CHANGELOG.md');
/** `undefined` before the first `pnpm release`: a first store version has no release notes. */
const notes = (() => {
  try {
    return notesFor(changelog, version) || undefined;
  } catch {
    return undefined;
  }
})();

const codeFor = (store, mapping) =>
  typeof mapping[store] === 'string' ? mapping[store] : undefined;
const mapped = (store) =>
  config.locales.flatMap((mapping) => {
    const code = codeFor(store, mapping);
    return code ? [{ locale: mapping.locale, code }] : [];
  });

/** `text` is `full` cut at a line boundary within `limit`, as the codegen trims release notes. */
function assertTrimmedNotes(text, full, limit, where) {
  assert.ok(length(text) <= limit, `${where} is over ${limit} characters`);
  assert.ok(full.startsWith(text), `${where} is not the CHANGELOG section for ${version}`);
  assert.ok(text === full || full[text.length] === '\n', `${where} is cut mid-line`);
}

describe('store listing locales (REQ-MOB-011)', () => {
  it('maps every app locale to each store, or skips a store with a reason', () => {
    assert.deepEqual(config.locales.map((mapping) => mapping.locale).sort(), LOCALES);
    for (const mapping of config.locales) {
      for (const store of ['appStore', 'googlePlay']) {
        const value = mapping[store];
        if (typeof value !== 'string') {
          assert.ok(value?.skip?.trim(), `${mapping.locale}: ${store} skip needs a reason`);
        }
      }
    }
  });

  it('writes a folder for each mapped store language and no other', () => {
    assert.deepEqual(
      folders(IOS).sort(),
      [...mapped('appStore').map(({ code }) => code), 'review_information'].sort()
    );
    assert.deepEqual(
      folders(ANDROID).sort(),
      mapped('googlePlay')
        .map(({ code }) => code)
        .sort()
    );
  });

  it('gives every App Store language every deliver file, within its limit', () => {
    for (const { locale, code } of mapped('appStore')) {
      const files = readdirSync(join(IOS, code)).sort();
      const expected = Object.keys({ ...APP_STORE_LIMITS, ...APP_STORE_URLS }).filter(
        (file) => file !== 'release_notes.txt' || notes !== undefined
      );
      assert.deepEqual(files, expected.sort(), `${code} (${locale})`);
      for (const [file, limit] of Object.entries(APP_STORE_LIMITS)) {
        if (!files.includes(file)) continue;
        const text = read(IOS, code, file);
        assert.ok(text.trim().length > 0, `${code}/${file} is empty`);
        assert.ok(length(text) <= limit, `${code}/${file}: ${length(text)} > ${limit}`);
      }
      const keywords = read(IOS, code, 'keywords.txt').split(',');
      assert.ok(
        keywords.every((keyword) => keyword.trim() !== ''),
        `${code}/keywords.txt`
      );
    }
  });

  it('gives every Google Play language every supply file, within its limit', () => {
    for (const { locale, code } of mapped('googlePlay')) {
      const files = readdirSync(join(ANDROID, code)).sort();
      const expected = [
        ...Object.keys(PLAY_LIMITS),
        ...(notes === undefined ? [] : ['changelogs']),
      ];
      assert.deepEqual(files, expected.sort(), `${code} (${locale})`);
      for (const [file, limit] of Object.entries(PLAY_LIMITS)) {
        const text = read(ANDROID, code, file);
        assert.ok(text.trim().length > 0, `${code}/${file} is empty`);
        assert.ok(length(text) <= limit, `${code}/${file}: ${length(text)} > ${limit}`);
      }
    }
  });

  it('names the app as the app does, with no trailing newline (supply uploads verbatim)', () => {
    for (const { locale, code } of mapped('appStore')) {
      assert.equal(
        read(IOS, code, 'name.txt'),
        json(ROOT, 'locales', locale, 'common.json').appName
      );
    }
    for (const { locale, code } of mapped('googlePlay')) {
      assert.equal(
        read(ANDROID, code, 'title.txt'),
        json(ROOT, 'locales', locale, 'common.json').appName
      );
      assert.ok(!read(ANDROID, code, 'full_description.txt').endsWith('\n'));
    }
  });
});

describe('release notes (REQ-MOB-011, REQ-REL-003)', () => {
  it(`are the CHANGELOG section of ${version}, trimmed to each store limit at a line`, () => {
    for (const { code } of mapped('appStore')) {
      const path = join(IOS, code, 'release_notes.txt');
      if (notes === undefined) {
        assert.ok(!existsSync(path), `${code}: no section for ${version}, so no release notes`);
        continue;
      }
      assertTrimmedNotes(read(path), notes, APP_STORE_LIMITS['release_notes.txt'], path);
    }
    for (const { code } of mapped('googlePlay')) {
      const dir = join(ANDROID, code, 'changelogs');
      if (notes === undefined) {
        assert.ok(!existsSync(dir), `${code}: no section for ${version}, so no changelog`);
        continue;
      }
      assert.deepEqual(readdirSync(dir), [`${buildNumber(version)}.txt`], dir);
      const path = join(dir, `${buildNumber(version)}.txt`);
      assertTrimmedNotes(read(path), notes, PLAY_CHANGELOG_LIMIT, path);
    }
  });

  it('trims at a line boundary (the rule the check above applies)', () => {
    assert.doesNotThrow(() => assertTrimmedNotes('a\nb', 'a\nb\nc', 4, 'x'));
    assert.throws(() => assertTrimmedNotes('a\nb', 'a\nbc', 4, 'x'), /cut mid-line/);
    assert.throws(() => assertTrimmedNotes('a\nb', 'z\nb', 4, 'x'), /not the CHANGELOG/);
    assert.throws(() => assertTrimmedNotes('abcde', 'abcde', 4, 'x'), /over 4/);
  });
});

describe('store addresses (REQ-MOB-011, REQ-ACC-007)', () => {
  it('are https, and the account-deletion address is the public deletion page', () => {
    for (const [name, url] of Object.entries(config.urls)) {
      assert.match(url, /^https:\/\/\S+$/, name);
    }
    assert.match(config.urls.accountDeletionUrl, /\/account-deletion\.html$/);
    assert.match(config.urls.privacyPolicyUrl, /^https:\/\//);
  });

  it('are written into every App Store language', () => {
    for (const { code } of mapped('appStore')) {
      for (const [file, key] of Object.entries(APP_STORE_URLS)) {
        assert.equal(read(IOS, code, file), config.urls[key], `${code}/${file}`);
      }
    }
  });

  it('name the account-deletion page in every description and in the App Review notes', () => {
    const url = config.urls.accountDeletionUrl;
    for (const { code } of mapped('appStore')) {
      assert.ok(read(IOS, code, 'description.txt').includes(url), `${code}/description.txt`);
    }
    for (const { code } of mapped('googlePlay')) {
      assert.ok(read(ANDROID, code, 'full_description.txt').includes(url), `${code}`);
    }
    assert.ok(read(IOS, 'review_information', 'notes.txt').includes(url));
  });
});
