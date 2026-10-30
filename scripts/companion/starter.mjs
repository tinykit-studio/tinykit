import { mkdir, readFile, realpath, access, lstat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportWorkspace, writeAtomic } from './workspace.mjs';
import { getToken, serverOrigin } from './auth.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function starterTemplate(id = 'project-tracker') { if (!['project-tracker', 'personal-crm'].includes(id)) throw new Error('Choose a supported starter.'); return JSON.parse(await readFile(join(packageRoot, `src/lib/templates/${id}.json`), 'utf8')); }
export async function launcherStore(directory) {
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory), runtime = join(root, '.tinykit');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await realpath(runtime) !== runtime) throw new Error('The launcher data folder must not be a link.');
  const path = join(runtime, 'apps.json');
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('The app index must not be a link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let index = { format_version: 1, apps: [] };
  try { index = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (index.format_version !== 1 || !Array.isArray(index.apps)) throw new Error('The app index could not be read.');
  return { root, runtime, index, save: () => writeAtomic(path, index) };
}
export function appDirectory(store, app) {
  if (!/^[a-z0-9-]+$/.test(app.folder) || !/^[a-z0-9]{15}$/.test(app.id)) throw new Error('Invalid saved app.');
  return join(store.root, app.folder);
}
export async function checkedAppDirectory(store, app) {
  const path = appDirectory(store, app), actual = await realpath(path);
  if (actual !== path || !actual.startsWith(store.root + sep)) throw new Error('The app folder must stay in your Tinykit apps folder.');
  const config = JSON.parse(await readFile(join(path, 'tinykit.json'), 'utf8'));
  if (config.project_id !== app.id || config.hosted?.server !== app.server) throw new Error('This folder is connected to a different app.');
  return path;
}
async function remote(server, token, path, body) {
  const response = await fetch(server + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(response.status === 401 ? 'Please sign in again to connect your app.' : result.message || result.error || `Tinykit could not complete setup (${response.status}). Retry to continue the same app.`); error.status = response.status; throw error; }
  return result;
}
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export async function createStarter(store, { server, name, request_id, template_id = 'project-tracker' }) {
  server = serverOrigin(server);
  const template = await starterTemplate(template_id);
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Give your app a name, up to 100 characters.');
  if (typeof request_id !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(request_id)) throw new Error('Refresh the starter page and try again.');
  const token = await getToken(server);
  let app = store.index.apps.find(app => app.request_id === request_id);
  if (app && (app.server !== server || app.name !== name.trim() || (app.template_id || 'project-tracker') !== template_id)) throw new Error('Retry with the same app name and account to finish setup.');
  if (!app) {
    const id = randomBytes(10).toString('hex').slice(0, 15);
    app = { id, request_id, template_id, server, name: name.trim(), folder: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'project-tracker'}-${id.slice(-6)}`, state: 'preparing', created_at: new Date().toISOString() };
    store.index.apps.unshift(app); await store.save();
  }
  try {
    let hosted;
    try { hosted = await remote(server, token, `/_pb/api/collections/_tk_projects/records/${app.id}`); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!hosted) {
      // Probe the upgraded endpoint before creating anything on an older server.
      const probe = await fetch(`${server}/api/projects/${app.id}/hosted`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      const detail = await probe.json().catch(() => null);
      if (probe.status !== 404 || !detail?.message) throw new Error('This Tinykit instance needs the companion publishing update before it can create your app.');
      const content = structuredClone(template.content); content.find(field => field.id === 'title').value = app.name;
      try {
        hosted = await remote(server, token, '/_pb/api/collections/_tk_projects/records', { id: app.id, name: app.name, kit: 'custom', frontend_code: template.frontend_code, backend_code: '', content, design: template.design, data: template.data, visibility: template.visibility || 'public', custom_instructions: `${template.description} Preserve existing records, relationships, settings, and app access. Customize the interface with Svelte 5. Prefer additive schema changes.`, settings: { template_id, icon: template.preview } });
      } catch (error) {
        // A lost response must resume this exact project, never create another.
        try { hosted = await remote(server, token, `/_pb/api/collections/_tk_projects/records/${app.id}`); } catch { throw error; }
      }
    }
    if (template.visibility === 'private' && (hosted.visibility !== 'private' || !hosted.owner)) throw new Error('Upgrade this Tinykit server with private-app access before using the CRM. Setup has stopped; no sample or customer records were uploaded.');
    const directory = appDirectory(store, app);
    let exists = false; try { await access(directory); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) {
      const exported = await remote(server, token, `/api/projects/${app.id}/export?include_records=0&include_assets=0`);
      if (exported.id !== app.id || exported.hosted?.server !== server) throw new Error('The server returned a different app connection.');
      await exportWorkspace(exported, directory, { includeRecords: false, includeAssets: false });
      await writeFile(join(directory, 'seeds.json'), JSON.stringify(template.preview_records, null, 2) + '\n');
      await writeFile(join(directory, 'AGENTS.md'), `# Tinykit app\n\nThe local companion is already running. Read instructions.md and CUSTOMIZE.md when present. Edit App.svelte (Svelte 5), content.json, design.json, schema.json, and assets/. This companion currently compiles a single component; keep component logic in App.svelte. Dependencies are already available; do not install packages or start another server.\n\nUse $content, $design, $data, and $tinykit. Source files are authoritative. Local sample records are separate from the live app. Never replace records, change project identity, read credentials, or edit .tinykit/. Add schema fields rather than removing or changing existing fields.\n\nCheck diagnostics with ${shellQuote(process.execPath)} ${shellQuote(join(packageRoot, 'scripts/tinykit.mjs'))} status . --json. Compilation requires the open companion preview; pending is not success. Fix compile errors before finishing. The user reviews and publishes in the companion; do not publish unless explicitly asked.\n`);
      await writeFile(join(directory, 'README.md'), `# ${app.name}\n\nOpen this app from the Tinykit launcher to continue. The companion provides one-click customization with Codex or Claude Code, a live preview, and Publish. It remembers the hosted destination. Local sample projects never replace your live records.\n`);
      await writeFile(join(directory, '.gitignore'), '.tinykit/\nCUSTOMIZE.md\n');
    }
    await checkedAppDirectory(store, app);
    const runtime = join(directory, '.tinykit'); await mkdir(runtime, { recursive: true, mode: 0o700 });
    if (await realpath(runtime) !== runtime) throw new Error('The app runtime folder must not be a link.');
    await writeAtomic(join(runtime, 'connection.json'), { server, project_id: app.id });
    await writeAtomic(join(runtime, 'credentials.json'), { server, token });
    await writeAtomic(join(runtime, 'journey.json'), { starter: template_id, launcher: store.root, local_sample_data: true });
    app.state = 'ready'; delete app.error; await store.save();
    return { app, directory };
  } catch (error) { app.state = 'needs_attention'; app.error = error.message; await store.save(); throw error; }
}
