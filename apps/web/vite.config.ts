import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  ACCOUNT_DELETION_PAGE,
  accountDeletionPlugin,
} from './src/account-deletion/accountDeletionPlugin.js';
import { cspPlugin } from './src/csp/cspPlugin.js';
import { resolveApiBaseUrl } from './src/shared/api/apiUrl.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // The public account-deletion page, static and in every language (REQ-ACC-007).
    accountDeletionPlugin(),
    // Production only (REQ-SEC-024): `connect-src` allows the API the build is configured for.
    cspPlugin({ apiUrl: resolveApiBaseUrl(loadEnv(mode, root, 'VITE_')) }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        accountDeletion: fileURLToPath(new URL(ACCOUNT_DELETION_PAGE, import.meta.url)),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
}));
