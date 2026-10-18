import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/api',
  'packages/core-ts',
  'packages/create-tran',
  'apps/web',
  'apps/native',
]);
