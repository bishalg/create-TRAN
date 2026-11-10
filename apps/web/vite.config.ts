import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cspPlugin } from './src/csp/cspPlugin.js';
import { resolveApiBaseUrl } from './src/shared/api/apiUrl.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Production only (REQ-SEC-024): `connect-src` allows the API the build is configured for.
    cspPlugin({ apiUrl: resolveApiBaseUrl(loadEnv(mode, root, 'VITE_')) }),
  ],
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
