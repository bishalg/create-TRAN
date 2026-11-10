/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRAN_API_URL?: string;
}

/** The app's product version, from `package.json` at build time (`vite.config.ts`). */
declare const __TRAN_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
