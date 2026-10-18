import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/api', 'packages/core-ts', 'packages/create-tran', 'apps/web', 'apps/native'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**', 'apps/web/src/**', 'apps/native/src/hooks/**'],
      exclude: [
        '**/generated/**', // emitted by `pnpm tokens:sync`, verified by the CI drift check
        '**/*.d.ts',
        'apps/web/src/main.tsx', // 5-line bootstrap, covered by E2E
        'packages/*/src/index.ts', // barrel re-exports
        'packages/create-tran/**', // scaffolding CLI, not part of the sample app
        'packages/api/src/contract.ts', // type-only contract
        'packages/core-ts/src/types.ts', // type-only
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
