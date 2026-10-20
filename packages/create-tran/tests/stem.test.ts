import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STEM,
  TEMPLATE_LIGHT_PRIMARY,
  applyDefaultTheme,
  applyPrimaryColor,
  applyStemRewrite,
  glowRgba,
  normalizeHexColor,
  stemForms,
  validateHexColor,
  validateStem,
} from '../src/stem.js';

describe('stem validation', () => {
  it('accepts short lowercase stems', () => {
    expect(validateStem('acme')).toBeNull();
    expect(validateStem('myapp')).toBeNull();
    expect(validateStem('a1')).toBeNull();
    expect(stemForms('Acme')).toEqual({
      lower: 'acme',
      pascal: 'Acme',
      upper: 'ACME',
    });
  });

  it('rejects invalid or reserved stems', () => {
    expect(validateStem('a')).not.toBeNull();
    expect(validateStem('Acme App')).not.toBeNull();
    expect(validateStem('node')).not.toBeNull();
    expect(validateStem(DEFAULT_STEM)).toBeNull();
  });
});

describe('stem rewrite', () => {
  it('rewrites coding prefixes without touching the upstream template URL', () => {
    const input = [
      'import { x } from "@tran/core";',
      'const url = process.env.VITE_TRAN_API_URL;',
      'class TranApiClient {}',
      'package com.tran.voting.generated',
      '--tran-spacing-md',
      'https://github.com/bishalg/create-TRAN.git',
      'crate tran-uniffi',
    ].join('\n');

    const out = applyStemRewrite(input, 'acme');
    expect(out).toContain('@acme/core');
    expect(out).toContain('VITE_ACME_API_URL');
    expect(out).toContain('class AcmeApiClient');
    expect(out).toContain('com.acme.voting.generated');
    expect(out).toContain('--acme-spacing-md');
    expect(out).toContain('https://github.com/bishalg/create-TRAN.git');
    expect(out).toContain('crate acme-uniffi');
    expect(out).not.toContain('@tran/');
  });

  // Verifies: REQ-GEN-004 — source paths name the same folders the package names do.
  it('rewrites the Android package in source paths too', () => {
    const out = applyStemRewrite(
      'apps/android/app/src/main/kotlin/com/tran/voting/generated',
      'acme'
    );
    expect(out).toBe('apps/android/app/src/main/kotlin/com/acme/voting/generated');
  });

  it('is a no-op for the default stem', () => {
    const sample = '@tran/core and TranEngine';
    expect(applyStemRewrite(sample, 'tran')).toBe(sample);
  });
});

describe('primary color patch', () => {
  it('normalizes and validates hex', () => {
    expect(normalizeHexColor('#0AF')).toBe('#00aaff');
    expect(validateHexColor('#0284c7')).toBeNull();
    expect(validateHexColor('blue')).not.toBeNull();
  });

  it('replaces template brand primaries and glows', () => {
    const snippet = [
      `primary: hex("${TEMPLATE_LIGHT_PRIMARY}"),`,
      'primary_glow: "rgba(2, 132, 199, 0.25)".into(),',
      'primary: hex("#38bdf8"),',
      'primary_glow: "rgba(56, 189, 248, 0.35)".into(),',
    ].join('\n');

    const out = applyPrimaryColor(snippet, '#0ea5e9');
    expect(out).toContain('#0ea5e9');
    expect(out).not.toContain(TEMPLATE_LIGHT_PRIMARY);
    expect(out).not.toContain('#38bdf8');
    expect(out).toContain(glowRgba('#0ea5e9', 0.25));
    expect(out).toContain(glowRgba('#0ea5e9', 0.35));
  });

  it('patches DEFAULT_THEME when not dark', () => {
    const src = 'pub const DEFAULT_THEME: &str = "dark";\n';
    expect(applyDefaultTheme(src, 'dark')).toBe(src);
    expect(applyDefaultTheme(src, 'light')).toContain('pub const DEFAULT_THEME: &str = "light";');
  });
});
