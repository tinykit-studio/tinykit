#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const REQUIRED_NODE = 22;
const major = version => Number(version.replace(/^v/, '').split('.')[0]);

// `#!/usr/bin/env node` runs whichever Node is first on PATH, which is often older
// than the one Tinykit was installed with. Find a compatible Node and rerun under it.
function findCompatibleNode() {
  // npm link / npm i -g puts the `tinykit` symlink next to the Node that installed it.
  const sibling = join(dirname(process.argv[1]), process.platform === 'win32' ? 'node.exe' : 'node');
  const candidates = [sibling];
  const nvm = join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions/node');
  try {
    const versions = readdirSync(nvm).filter(v => major(v) >= REQUIRED_NODE)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    candidates.push(...versions.map(v => join(nvm, v, 'bin/node')));
  } catch {}
  return candidates.find(path => path !== process.execPath && existsSync(path));
}

if (major(process.versions.node) < REQUIRED_NODE && !process.env.TINYKIT_NODE_REEXEC) {
  const node = findCompatibleNode();
  if (!node) {
    console.error(`Tinykit needs Node.js ${REQUIRED_NODE} or newer (this shell has ${process.version}).\nInstall it with \`nvm install ${REQUIRED_NODE}\`, or switch with \`nvm use ${REQUIRED_NODE}\`, then retry.`);
    process.exit(1);
  }
  const child = spawn(node, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, TINYKIT_NODE_REEXEC: '1' } });
  // Ctrl+C in a terminal already reaches the child (same process group), but a SIGINT
  // sent to this PID alone would not. Forward it as SIGTERM: dev handles both, once.
  process.on('SIGINT', () => child.kill('SIGTERM'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', error => { console.error(`Could not start ${node}: ${error.message}`); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  const { run } = await import('./cli.mjs');
  try { await run(process.argv.slice(2)); }
  catch (error) {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: error.message, ...(error.creation ? { creation: error.creation } : {}), ...(error.push ? { push: error.push } : {}), ...(error.publish ? { publish: error.publish } : {}) }, null, 2));
    console.error(error.message);
    process.exitCode = 1;
  }
}
