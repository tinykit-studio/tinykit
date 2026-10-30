#!/usr/bin/env node
import { run } from './cli.mjs';

try { await run(process.argv.slice(2)); }
catch (error) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: error.message, ...(error.creation ? { creation: error.creation } : {}), ...(error.push ? { push: error.push } : {}), ...(error.publish ? { publish: error.publish } : {}) }, null, 2));
  console.error(error.message);
  process.exitCode = 1;
}
