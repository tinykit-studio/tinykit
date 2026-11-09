import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, rm, open as openFile, copyFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import PocketBase from 'pocketbase';
import { compile } from 'svelte/compiler';
import { readWorkspace, mergeLocalData, writeAtomic } from './workspace.mjs';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const selected = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return selected;
}

export function syntaxDiagnostic(source) {
  try {
    // Match the browser compiler's support for <style global>.
    const code = source.replace(/<style(\s+global)(\s[^>]*)?>([^]*?)<\/style>/gi, (_, global, attrs, css) => `<style${attrs || ''}>:global {${css}}</style>`);
    compile(code, { filename: 'App.svelte', generate: 'client', dev: true });
    return null;
  } catch (error) {
    return { file: 'App.svelte', message: error.message, line: error.start?.line, column: error.start?.column, frame: error.frame };
  }
}

export async function claimWorkspace(runtime, filename = 'dev.lock') {
  const lock = join(runtime, filename);
  // A crashed process leaves a lock. Only reclaim it when its recorded PID is gone.
  try {
    const prior = JSON.parse(await readFile(lock, 'utf8'));
    let alive = true;
    try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error(filename === 'dev.lock'
      ? `This workspace already has a dev process (${prior.pid}). Stop it before starting another.`
      : `This workspace already has a build or publish process (${prior.pid}). Wait for it to finish before starting another.`);
    await rm(lock);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const file = await openFile(lock, 'wx', 0o600);
  await file.writeFile(JSON.stringify({ pid: process.pid }));
  await file.close();
  return () => rm(lock, { force: true });
}

export async function startCompanion(directory, { port, open, appOnly }) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 19)) throw new Error('tinykit dev requires Node.js 20.19 or newer.');
  const root = await realpath(directory);
  const initial = await readWorkspace(root);
  const runtime = join(root, '.tinykit');
  const portPath = join(runtime, 'port.json');
  if (port === undefined && initial.config.local_first) {
    // Reuse the last port so bookmarked editor URLs keep working; fall back to any free port.
    let saved;
    try { saved = JSON.parse(await readFile(portPath, 'utf8')).port; } catch {}
    port = Number.isInteger(saved) ? await availablePort(saved).catch(() => availablePort(0)) : await availablePort(0);
  } else port = await availablePort(port ?? 5173);
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await realpath(runtime) !== runtime) throw new Error('.tinykit must not be a symlink.');
  const release = await claimWorkspace(runtime);
  // Best effort: a failed save only means the next run picks a new port.
  if (initial.config.local_first) await writeAtomic(portPath, { port }).catch(() => {});
  let pbProcess, viteProcess, timer, closing = false, syncing = Promise.resolve();
  const stopChild = async child => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(force);
  };
  const cleanup = async () => {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    await syncing.catch(() => {});
    await stopChild(viteProcess);
    await stopChild(pbProcess);
    await rm(join(runtime, 'dev-server.json'), { force: true });
    await release();
  };
  const stop = () => { cleanup().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const pbPort = await availablePort();
    const pbURL = `http://127.0.0.1:${pbPort}`;
    const binary = join(packageRoot, 'pocketbase', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
    try { await exec(binary,['--version'],{timeout:5000}); }
    catch { throw new Error('PocketBase is missing or cannot start. From the Tinykit installation, run npm run pocketbase:download, then retry tinykit dev.'); }
    const dataDirectory = join(runtime, 'pb_data');
    const hooksDirectory = join(runtime, 'pb_hooks');
    await mkdir(dataDirectory, { recursive: true });
    await mkdir(hooksDirectory, { recursive: true });
    if (await realpath(dataDirectory) !== dataDirectory || await realpath(hooksDirectory) !== hooksDirectory) throw new Error('Local runtime directories must not be symlinks.');
    const pendingHook = join(hooksDirectory, `app-data-write.${randomUUID()}.tmp`);
    await copyFile(join(packageRoot, 'pocketbase/pb_hooks/app-data-write.pb.js'), pendingHook, constants.COPYFILE_EXCL);
    await rename(pendingHook, join(hooksDirectory, 'app-data-write.pb.js'));
    const flags = ['--dir', dataDirectory, '--migrationsDir', join(packageRoot, 'pocketbase/pb_migrations'), '--hooksDir', hooksDirectory];
    const email = 'companion@localhost.test', password = randomBytes(32).toString('hex');
    await exec(binary, ['superuser', 'upsert', email, password, ...flags]);
    pbProcess = spawn(binary, ['serve', '--http', `127.0.0.1:${pbPort}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
    let startupError;
    pbProcess.on('error', error => { startupError = error; });
    pbProcess.stdout.on('data', () => {});
    pbProcess.stderr.on('data', chunk => console.error(`[local data] ${chunk.toString().trim()}`));
    const pb = new PocketBase(pbURL);
    pb.autoCancellation(false);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (startupError) throw startupError;
      if (pbProcess.exitCode !== null) throw new Error('Local PocketBase exited during startup.');
      try { await pb.health.check(); ready = true; break; } catch { await delay(100); }
    }
    if (!ready) throw new Error('Local PocketBase did not become ready.');
    await pb.collection('_superusers').authWithPassword(email, password);

    const projectId = initial.config.project_id;
    const sessionId = randomUUID();
    let appliedRevision = '', observedRevision = '', assetRevision = '', lastError = '', revisionNumber = 0;
    const statusPath = join(runtime, 'status.json');
    const sync = async workspace => {
      if (workspace.config.project_id !== projectId) throw new Error('tinykit.json: project_id cannot change while dev is running.');
      let existing;
      try { existing = await pb.collection('_tk_projects').getOne(projectId); } catch (error) { if (error.status !== 404) throw error; }
      const patch = { ...workspace.project, kit: 'custom', domain: '', settings: { companion_revision: workspace.revision }, data: mergeLocalData(existing?.data || {}, workspace.schema, workspace.seeds) };
      // Avoid racing preview CRUD: source-only edits never write runtime data.
      if (existing && JSON.stringify(patch.data) === JSON.stringify(existing.data)) delete patch.data;
      if (existing) await pb.collection('_tk_projects').update(projectId, patch);
      else await pb.collection('_tk_projects').create({ ...patch, id: projectId });
      const diagnostic = syntaxDiagnostic(workspace.project.frontend_code);
      appliedRevision = workspace.revision;
      assetRevision = workspace.assetRevision;
      lastError = '';
      await writeAtomic(statusPath, { session_id: sessionId, project_id: projectId, revision: ++revisionNumber, source_revision: appliedRevision, asset_revision: workspace.assetRevision, synced_at: new Date().toISOString(), diagnostic });
      console.log(diagnostic ? `App.svelte${diagnostic.line ? ':' + diagnostic.line : ''}: ${diagnostic.message}` : `Synced ${workspace.config.name} (revision ${revisionNumber})`);
    };
    await sync(initial);

    // The child runtime has its own credentials and never reads the Studio setup file.
    process.env.TINYKIT_COMPANION_DIR = root;
    process.env.TINYKIT_COMPANION_ID = projectId;
    process.env.TINYKIT_COMPANION_ORIGIN = `http://127.0.0.1:${port}`;
    process.env.POCKETBASE_URL = pbURL;
    process.env.POCKETBASE_ADMIN_EMAIL = email;
    process.env.POCKETBASE_ADMIN_PASSWORD = password;
    process.env.TINYKIT_SETUP_FILE = join(runtime, '.unused-setup');
    viteProcess = spawn(process.execPath, [join(packageRoot, 'scripts/companion/server.mjs'), String(port)], { cwd: packageRoot, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
    let viteError;
    viteProcess.on('error', error => { viteError = error; });
    let frontendReady = false;
    for (let i = 0; i < 100; i++) {
      if (viteError) throw viteError;
      if (viteProcess.exitCode !== null) throw new Error('The editor server exited during startup.');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/companion/state`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { frontendReady = true; break; }
      } catch {}
      await delay(100);
    }
    if (!frontendReady) throw new Error('The editor server did not become ready.');
    const url = `http://127.0.0.1:${port}/companion`;
    const previewUrl = url + '?view=app';
    await writeAtomic(join(runtime, 'dev-server.json'), { pid: process.pid, url, preview_url: previewUrl, project_id: projectId });
    console.log(`\n${initial.config.name} is running.\n\n  Editor:    ${url}\n  App only:  ${previewUrl}\n\nWatching ${root} for changes. Ctrl+C to stop.\n`);
    if (open) {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      const opener = spawn(command, [appOnly ? previewUrl : url], { stdio: 'ignore' });
      opener.on('error', () => console.log(`Open ${appOnly ? previewUrl : url} in your browser.`));
    }
    const tick = async () => {
      try {
        const workspace = await readWorkspace(root);
        // Two matching reads coalesce multi-file and atomic editor saves.
        if (workspace.revision === observedRevision && (workspace.revision !== appliedRevision || lastError)) await sync(workspace);
        observedRevision = workspace.revision;
      } catch (error) {
        observedRevision = '';
        if (lastError !== error.message) {
          lastError = error.message;
          console.error(`Import error: ${lastError}`);
          await writeAtomic(statusPath, { session_id: sessionId, project_id: projectId, revision: revisionNumber, source_revision: appliedRevision, asset_revision: assetRevision, import_error: lastError });
        }
      }
    };
    const schedule = () => { timer = setTimeout(() => { syncing = tick().finally(() => { if (!closing) schedule(); }); }, 250); };
    schedule();
    pbProcess.once('exit', () => { if (!closing) { console.error('Local data process stopped.'); cleanup().then(() => process.exit(1)); } });
    viteProcess.once('exit', () => { if (!closing) { console.error('The editor server stopped.'); cleanup().then(() => process.exit(1)); } });
  } catch (error) {
    await cleanup();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    throw error;
  }
}
