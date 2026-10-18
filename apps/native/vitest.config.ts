import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Hooks are tested with a DOM renderer; they import only `react` and `@tran/core`,
    // never `react-native`, which keeps them runnable in plain Node CI.
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
