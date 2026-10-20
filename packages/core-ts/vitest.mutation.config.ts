// Stryker only (stryker.config.json): this package's tests on their own, without the root projects list.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
