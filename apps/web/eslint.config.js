// Verifies: REQ-WEB-013 — enforced in CI via pnpm lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/shared/ui');

const bannedTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'button', 'table', 'th', 'td'];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/ui/**', '**/*.test.{ts,tsx}'],
    plugins: { react },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react/forbid-dom-props': ['error', { forbid: ['style'] }],
      'no-restricted-syntax': [
        'error',
        ...bannedTags.map((tag) => ({
          selector: `JSXOpeningElement[name.name='${tag}']`,
          message: `Use shared/ui atoms instead of raw <${tag}>.`,
        })),
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Use design tokens — no hex literals in JSX.',
        },
        {
          selector: 'Literal[value=/\\d+(\\.\\d+)?px\\b/]',
          message: 'Use design tokens — no px literals in JSX.',
        },
      ],
    },
  }
);

void uiDir;
