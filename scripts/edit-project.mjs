import { access, mkdir, readFile, lstat, open, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { defaultServer, serverOrigin } from './companion/auth.mjs';
import { claimWorkspace } from './companion/dev.mjs';
import { agentEnvironment } from './companion/agent-environment.mjs';
import { codexStatus } from './companion/codex.mjs';
import { componentConfig, requireNode, runtimeDirectory, childEnvironment } from './static-project/cli.mjs';
import { exportProject, parseExportArgs } from './export-project.mjs';

const cli = fileURLToPath(new URL('./tinykit.mjs', import.meta.url)), execute = promisify(execFile);
const projectId = /^[a-z0-9]{15}$/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
export function parseEditArgs(args) {
  const options = { input: '.', agent: 'codex', launch: true, json: false };
  let input = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--server', '--directory', '--agent'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} needs a value.`);
      const value = args[++i];
      if (arg === '--server') options.server = serverOrigin(value);
      else if (arg === '--directory') options.directory = resolve(value);
      else options.agent = value;
    } else if (arg === '--no-agent') options.launch = false;
    else if (arg === '--register-only') { options.registerOnly = true; options.launch = false; }
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('-') || input) throw new Error(`Unknown edit argument: ${arg}`);
    else { options.input = arg; input = true; }
  }
  if (options.agent !== 'codex') throw new Error('This handoff opens Codex desktop. Use --agent codex.');
  return options;
}
async function registry() {
  const root = resolve(process.env.TINYKIT_CONFIG_DIR || join(homedir(), '.config/tinykit'));
  const path = join(root, 'workspaces.json');
  for (const entry of [root, path]) {
    try { if ((await lstat(entry)).isSymbolicLink()) throw new Error('The workspace registry must not be a symlink.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  let data = { format_version: 1, workspaces: [] };
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (data.format_version !== 1 || !Array.isArray(data.workspaces) || data.workspaces.some(item => !item || !projectId.test(item.project_id) || typeof item.server !== 'string' || typeof item.directory !== 'string')) throw new Error('Invalid workspace registry.');
  return { root, path, data };
}
export async function rememberWorkspace({ root: directory, config }) {
  const server = serverOrigin(config.server), store = await registry();
  const release = await claimWorkspace(store.root, 'workspaces.lock');
  try {
    // Read again under the lock so two registrations cannot discard each other.
    const current = await registry();
    const others = current.data.workspaces.filter(item => item.server !== server || item.project_id !== config.project_id);
    const data = { format_version: 1, workspaces: [...others, { server, project_id: config.project_id, directory, agent: 'codex' }] };
    const temporary = join(store.root, `.workspaces-${randomUUID()}`);
    try { await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, store.path); }
    finally { await rm(temporary, { force: true }); }
  } finally { await release(); }
}
async function checkedFolder(directory, server, id) {
  let app;
  try { app = await componentConfig(directory); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('This workspace moved or is incomplete. Run tinykit edit /path/to/the/app to register its current folder.'); throw error; }
  if (!app) throw new Error('tinykit edit needs an exported Svelte project. Export it with tinykit export first.');
  if (!projectId.test(app.config.project_id)) throw new Error('This folder has an invalid Tinykit project ID.');
  app.config.server = serverOrigin(app.config.server);
  if ((server && app.config.server !== server) || (id && app.config.project_id !== id)) throw new Error('This folder belongs to a different Tinykit app or server. Choose the correct folder; local files were not changed.');
  return app;
}
export async function resolveEditWorkspace(options) {
  if (!projectId.test(options.input)) {
    if (options.directory) throw new Error('--directory is used with a project ID. To register a folder, run tinykit edit /path/to/app.');
    return { ...await checkedFolder(resolve(options.input), options.server), created: false };
  }
  const selected = options.server || await defaultServer();
  if (!selected) throw new Error('Choose a server with --server <origin>, or run tinykit login first.');
  const server = serverOrigin(selected);
  if (options.directory) {
    try { await access(options.directory); return { ...await checkedFolder(options.directory, server, options.input), created: false }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const { data } = await registry();
  const saved = data.workspaces.find(item => item.server === server && item.project_id === options.input);
  if (saved && !options.directory) {
    const app = await checkedFolder(saved.directory, server, options.input);
    if (app.root !== saved.directory) throw new Error('The registered workspace path changed. Run tinykit edit /path/to/app to register its current folder.');
    return { ...app, created: false };
  }
  if (options.registeredOnly) throw new Error('This app is not registered on this Mac. In Studio, use Copy command to set it up, or run tinykit edit . inside its existing folder.');
  if (options.registerOnly) throw new Error('Register an existing app folder with tinykit edit /path/to/app --register-only.');
  const key = createHash('sha256').update(server).digest('hex').slice(0, 8);
  const target = options.directory || join(homedir(), 'Tinykit Apps', `${options.input}-${key}`);
  await mkdir(resolve(target, '..'), { recursive: true });
  await exportProject(parseExportArgs([options.input, target, '--server', server]));
  return { ...await checkedFolder(target, server, options.input), created: true };
}
export async function runningEditPreview(app) {
  let state;
  try { state = JSON.parse(await readFile(join(app.root, '.tinykit/dev-server.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (state.runtime !== 'svelte-vite' || !alive(state.pid)) return null;
  const url = new URL(state.url);
  if (url.origin !== `http://127.0.0.1:${state.port}` || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid local preview address. Restart tinykit dev in this app folder.');
  // A live PID alone could have been recycled. Verify the actual server too.
  const response = await fetch(`${url.origin}/__tinykit/edit-ready`, { signal: AbortSignal.timeout(2000), redirect: 'error' }).catch(() => null);
  if (response?.ok && typeof state.session === 'string' && (await response.json()).session === state.session) return url.origin;
  throw new Error('The recorded preview could not be verified. Stop the old preview and restart tinykit dev in this app folder.');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export async function ensureEditPreview(app, { json = false, registeredOnly = false } = {}) {
  const current = await runningEditPreview(app);
  if (current) return { url: current, reused: true };
  try { await access(join(app.root, 'node_modules/vite/package.json')); }
  catch {
    if (registeredOnly) throw new Error('This app needs dependencies before it can open from Studio. Run tinykit edit . in its folder once, then retry the button.');
    const locked = await access(join(app.root, 'package-lock.json')).then(() => true, () => false);
    if (!json) console.error('Installing this app’s dependencies…');
    try { await execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', [locked ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: app.root, env: { ...childEnvironment(), PATH: agentEnvironment().PATH }, timeout: 180000, maxBuffer: 1000000 }); }
    catch (error) { throw new Error(`Could not install dependencies in ${app.root}. Run ${locked ? 'npm ci' : 'npm install'} there, then retry tinykit edit.\n${String(error.stderr || error.message).slice(-2000)}`); }
  }
  const runtime = await runtimeDirectory(app.root), port = await freePort();
  const logPath = join(runtime, 'edit-preview.log');
  try { if ((await lstat(logPath)).isSymbolicLink()) throw new Error('The preview log must not be a symlink.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const log = await open(logPath, 'a', 0o600);
  const child = spawn(process.execPath, [cli, 'dev', app.root, '--port', String(port), '--no-open'], {
    cwd: app.root, env: childEnvironment(), detached: true, stdio: ['ignore', log.fd, log.fd]
  });
  let spawnError; child.on('error', error => { spawnError = error; });
  child.unref(); await log.close();
  for (let i = 0; i < 200; i++) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`The preview did not start. Check ${join(runtime, 'edit-preview.log')} and retry.`);
    try {
      const state = JSON.parse(await readFile(join(runtime, 'dev-server.json'), 'utf8'));
      if (state.pid === child.pid) {
        const url = await runningEditPreview(app);
        if (url) return { url, reused: false };
      }
    } catch {}
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error('The preview took too long to start. Retry after checking .tinykit/edit-preview.log.');
}
export async function stopEditPreview(app) {
  const path = join(app.root, '.tinykit/dev-server.json');
  let before;
  try { before = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = await runningEditPreview(app);
  if (!url) return { ok: true, stopped: false, message: 'This app has no running Tinykit preview.' };
  const current = JSON.parse(await readFile(path, 'utf8'));
  if (current.pid !== before.pid || current.session !== before.session) throw new Error('The preview changed while stopping. Run tinykit stop again.');
  process.kill(current.pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (state.pid !== current.pid || state.session !== current.session) break;
    } catch (error) { if (error.code === 'ENOENT') return { ok: true, stopped: true, message: 'Stopped this app’s local preview.' }; throw error; }
    await delay(100);
  }
  throw new Error('The preview has not finished stopping. Check tinykit status before retrying.');
}
export function codexWorkspaceLink(directory, context) {
  const link = new URL('codex://threads/new');
  link.searchParams.set('path', directory);
  link.searchParams.set('prompt', `I want to edit this Tinykit app. Read AGENTS.md, instructions.md, and .tinykit/edit-context.md before editing.\n\n${context}\nMy change: `);
  return link.href;
}
export async function openEditAgent(agent, directory, context, run = execute) {
  // Use the documented workspace+composer deep link with the installed app;
  // never start an installer or automatically submit an agent request.
  await run('/usr/bin/open', ['-a', agent.app, codexWorkspaceLink(directory, context)], { cwd: directory, env: agentEnvironment(), timeout: 15000, maxBuffer: 100000 });
}
export async function editProject(options, adapters = {}) {
  requireNode();
  const app = await resolveEditWorkspace(options);
  await rememberWorkspace(app);
  if (options.registerOnly) return { ok: true, directory: app.root, server: app.config.server, project_id: app.config.project_id, registered: true, message: `Registered ${app.config.name} at ${app.root}.` };
  const agent = options.launch ? await (adapters.agentStatus || codexStatus)() : null;
  if (options.launch && !agent.available) throw new Error(`${agent.message}\nYour workspace is registered at ${app.root}. Retry tinykit edit after installing/signing in, or use --no-agent to prepare only the preview.`);
  const preview = await (adapters.preview || ensureEditPreview)(app, options);
  const runtime = await runtimeDirectory(app.root), context = join(runtime, 'edit-context.md');
  const note = `# Tinykit editing context\n\nApp: ${app.config.name}\nFolder: ${app.root}\nServer: ${app.config.server}\nProject: ${app.config.project_id}\nLocal preview: ${preview.url}\n\nRead AGENTS.md and instructions.md. Edit normal Svelte components under src/. Run tinykit check --json after changes and fix reported failures. Verify interactions in the local preview. Publishing is an explicit tinykit publish command; local fields and records are isolated from the hosted app. Keep credentials outside source.\n`;
  try { if ((await lstat(context)).isSymbolicLink()) throw new Error('The editing context must not be a symlink.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(context, note, { mode: 0o600 });
  if (options.launch) await (adapters.openAgent || (async () => {
    try { await openEditAgent(agent, app.root, note); }
    catch { throw new Error(`Could not open Codex desktop. Your folder and preview are ready: ${app.root}\n${preview.url}\nRetry tinykit edit to reopen them.`); }
  }))();
  return { ok: true, runtime: 'svelte-vite', directory: app.root, server: app.config.server, project_id: app.config.project_id,
    created: app.created, preview_url: preview.url, preview_reused: preview.reused, context_file: context, agent: 'codex', agent_opened: options.launch,
    message: `${options.launch ? 'Opened Codex for' : 'Ready to edit'} ${app.config.name}.\nFolder: ${app.root}\nPreview: ${preview.url}\nContext: ${context}\nRun tinykit check --json after edits; tinykit publish when ready. The preview stays running; use tinykit status --json to inspect it and tinykit stop to stop it from this folder.` };
}
