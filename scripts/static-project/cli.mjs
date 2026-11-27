import { readFile, mkdir, realpath, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getToken, serverOrigin } from '../companion/auth.mjs';
import { claimWorkspace } from '../companion/dev.mjs';
import { writeAtomic } from '../companion/workspace.mjs';
import { sourceHash, readSourceTree } from './source-tree.mjs';
import { publish } from './publish.mjs';

const runner = fileURLToPath(new URL('./vite-runner.mjs', import.meta.url));
export async function componentConfig(directory) {
  const root = await realpath(directory);
  let config;
  try { config = JSON.parse(await readFile(join(root, 'tinykit.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (config.format_version !== 2) return null;
  await access(join(root, 'src/App.svelte'));
  await access(join(root, 'package.json'));
  return { root, config };
}
export function requireNode() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Svelte project commands require Node.js 22+. Run nvm use in the app folder.');
}
export async function runtimeDirectory(root) {
  const runtime = join(root, '.tinykit');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await realpath(runtime) !== runtime) throw new Error('.tinykit must not be a symlink.');
  return runtime;
}
export function childEnvironment() {
  const env = { ...process.env };
  delete env.TINYKIT_TOKEN; delete env.TINYKIT_TOKEN_FILE;
  return env;
}
function startVite(mode, root, options) {
  return spawn(process.execPath, [runner, mode, root, JSON.stringify(options)], { cwd: root, env: childEnvironment(),
    stdio: ['ignore', options.json ? 'pipe' : 'inherit', options.json ? 'pipe' : 'inherit', ...(mode === 'dev' ? ['ipc'] : [])] });
}
export async function installed(root) {
  try { await access(join(root, 'node_modules/vite/package.json')); }
  catch { throw new Error(`Install this app's dependencies first: cd ${JSON.stringify(root)} && npm ci (or npm install if it has no lockfile).`); }
}
async function readOptional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
export async function componentStatus(root) {
  const config = JSON.parse(await readFile(join(root, 'tinykit.json'), 'utf8'));
  const bundle = await readSourceTree(root), hash = sourceHash(Buffer.from(bundle.files['src/App.svelte'], 'base64').toString('utf8'), bundle);
  const dev = await readOptional(join(root, '.tinykit/dev-server.json'));
  let running = false;
  if (dev?.runtime === 'svelte-vite') try { process.kill(dev.pid, 0); running = true; } catch (error) { if (error.code === 'EPERM') running = true; }
  const built = await readOptional(join(root, '.tinykit/build-source.json'));
  return { ok: true, runtime: 'svelte-vite', running, url: running ? dev.url : null, source_hash: hash,
    source_files: Object.keys(bundle.files).length, build: { state: !built ? 'missing' : built.source_hash === hash ? 'current' : 'stale' },
    published_baseline: config.source_hash, last_publish: await readOptional(join(root, '.tinykit/last-publish.json')) };
}
export async function startComponentDev(root, { port = 5180, open = true } = {}) {
  requireNode(); await installed(root);
  const runtime = await runtimeDirectory(root), release = await claimWorkspace(runtime);
  const session = randomUUID();
  const child = startVite('dev', root, { port, open, json: false, session });
  let closing = false;
  const stop = () => { if (!closing) { closing = true; child.kill('SIGTERM'); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Local preview stopped before it was ready (${code}). Check the port and Vite errors above.`)));
      child.once('message', async message => {
        try {
          if (message.event !== 'ready') return;
          await writeAtomic(join(runtime, 'dev-server.json'), { runtime: 'svelte-vite', pid: process.pid, url: message.url, port, session });
          console.log(`Local app: ${message.url}\nChanges use isolated local data. Press Ctrl+C to stop.`);
          resolveReady();
        } catch (error) { reject(error); }
      });
    });
    await new Promise((done, reject) => {
      child.once('exit', code => code === 0 || closing ? done() : reject(new Error(`Local preview exited (${code}).`)));
      child.once('error', reject);
    });
  } finally {
    stop();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    await rm(join(runtime, 'dev-server.json'), { force: true });
    await release();
  }
}
async function buildProject(root, json) {
  await installed(root);
  const child = startVite('build', root, { json });
  let output = '';
  if (json) for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { output = (output + value).slice(-6000); });
  await new Promise((done, reject) => {
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const clear = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    child.once('error', error => { clear(); reject(error); });
    child.once('exit', (code, signal) => {
      clear();
      if (code === 0) done();
      else { const error = new Error(`Build failed; the hosted app was not changed.${output ? '\n' + output : signal ? ' Build interrupted.' : ''}`); error.publish = { state: 'failed', stage: 'build' }; reject(error); }
    });
  });
}
export async function componentCommand(command, { root, config }, options) {
  requireNode();
  const server = serverOrigin(config.server);
  if (options.server && serverOrigin(options.server) !== server || options.project && options.project !== config.project_id) throw new Error('This folder is linked to a different target. Export the other app into a fresh folder.');
  if (!['publish', 'remote-status'].includes(command)) throw new Error('Component projects publish directly from their source folder. Use tinykit publish; export a fresh copy to reconcile hosted changes.');
  const token = await getToken(server, { root });
  const response = await fetch(`${server}/api/projects/${config.project_id}/export`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (response.status === 401) throw new Error(`Your sign-in expired. Run tinykit login --server ${server} --email <email>.`);
  if (!response.ok) throw new Error(`Cannot read this hosted app (${response.status}). Check the project and account permissions.`);
  const remote = await response.json(), remoteHash = remote.source_hash || sourceHash(remote.frontend_code, remote.source_bundle);
  const local = await readSourceTree(root), localHash = sourceHash(Buffer.from(local.files['src/App.svelte'], 'base64').toString('utf8'), local);
  const previousFiles = remote.source_bundle?.files || {};
  const changes = [...new Set([...Object.keys(previousFiles), ...Object.keys(local.files)])].sort().filter(name => previousFiles[name] !== local.files[name]);
  const public_url = `${server}/tinykit/preview/${config.project_id}`;
  if (command === 'remote-status') return { ok: true, runtime: 'svelte-vite', server, project_id: config.project_id, source_hash: remoteHash, local_source_hash: localHash, conflict: remoteHash !== config.source_hash, in_sync: localHash === remoteHash, changed_files: changes, public_url };
  if (remoteHash !== config.source_hash) throw new Error('Hosted source changed since export/publish. Export it into a fresh folder, review and reconcile your edits, then publish from that copy. Live records and field edits are not source conflicts.');
  const runtime = await runtimeDirectory(root), release = await claimWorkspace(runtime, 'component-publish.lock');
  try {
    if (!options.json) console.log(`Building ${config.name} for ${server} (${changes.length} changed source files)…`);
    await buildProject(root, options.json);
    const builtLocal = await readSourceTree(root);
    if (sourceHash(Buffer.from(builtLocal.files['src/App.svelte'], 'base64').toString('utf8'), builtLocal) !== localHash) throw new Error('Source changed while preparing publication. Save your files and publish again.');
    const result = await publish(root, { token, log: false, server, project_id: config.project_id });
    const publication = { state: 'succeeded', source_hash: result.source_hash, source_files: Object.keys(local.files).length, changed_files: changes, published_at: new Date().toISOString(), public_url };
    await writeAtomic(join(runtime, 'last-publish.json'), publication);
    return { ok: true, runtime: 'svelte-vite', server, project_id: config.project_id, publish: publication, public_url,
      message: `Published ${config.name} (${changes.length} changed source files). Live fields and records were preserved.\n${public_url}` };
  } finally { await release(); }
}
