#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

let runtime;
try {
  runtime = JSON.parse(await readFile(new URL('../runtime.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  runtime = {
    node: process.execPath,
    entrypoint: fileURLToPath(new URL('../../../scripts/tinykit.mjs', import.meta.url))
  };
}
try {
  await access(runtime.entrypoint);
  const child = spawn(runtime.node, [runtime.entrypoint, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: false
  });
  child.on('error', () => {
    console.error(
      'The Tinykit installation moved or cannot start. Reinstall its skill from the working Tinykit checkout.'
    );
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch {
  console.error(
    'The Tinykit installation is unavailable. Reinstall its skill from the working Tinykit checkout.'
  );
  process.exitCode = 1;
}
