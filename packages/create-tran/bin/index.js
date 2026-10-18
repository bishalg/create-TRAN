#!/usr/bin/env node

import { runCli } from '../dist/cli.js';

runCli().catch((err) => {
  process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
