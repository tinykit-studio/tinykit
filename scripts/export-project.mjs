import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getToken, defaultServer, serverOrigin } from './companion/auth.mjs';
import { exportWorkspace } from './companion/workspace.mjs';
import { exportStaticProject } from './static-project/export.mjs';

export function parseExportArgs(args) {
  const options = { paths: [], includeRecords: false, includeAssets: false, svelte: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--server') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--server needs an origin.');
      options.server = serverOrigin(args[++i]);
    } else if (arg === '--include-records') options.includeRecords = true;
    else if (arg === '--include-assets') options.includeAssets = true;
    else if (arg === '--svelte') options.svelte = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown export argument: ${arg}`);
    else options.paths.push(arg);
  }
  if (options.paths.length !== 2) throw new Error('Usage: tinykit export <project-id|export.json> <new-directory> [--server <origin>] [--include-records] [--svelte]');
  return options;
}

export async function exportProject(options) {
  const [input, directory] = options.paths;
  const target = resolve(directory);
  try { await access(target); throw new Error('Export destination already exists. Choose a new folder to preserve your local work.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let project, server = options.server;
  const remote = /^[a-z0-9]{15}$/.test(input);
  if (remote) {
    server ||= await defaultServer();
    if (!server) throw new Error('Choose a server with --server <origin>, or run tinykit login first.');
    server = serverOrigin(server);
    const token = await getToken(server);
    const query = new URLSearchParams({ include_records: options.includeRecords ? '1' : '0', include_assets: options.includeAssets ? '1' : '0' });
    const response = await fetch(`${server}/api/projects/${input}/export?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (response.status === 401) throw new Error(`Sign-in expired. Run tinykit login --server ${server} --email <email>.`);
    if (!response.ok) throw new Error(`Cannot export this app (${response.status}). Check the project ID and account permissions.`);
    project = await response.json();
    if (project.id !== input) throw new Error('Server returned a different project identity.');
  } else {
    project = JSON.parse(await readFile(resolve(input), 'utf8'));
    server ||= project.hosted?.server;
  }
  const svelte = remote || options.svelte || Boolean(project.source_bundle);
  const includeRecords = options.includeRecords || (!remote && project.export_options?.include_records === true);
  const includeAssets = options.includeAssets || (!remote && project.export_options?.include_assets === true);
  let root;
  if (svelte) {
    if (includeAssets && project.assets?.length) throw new Error('Svelte export preserves imported source assets; runtime uploads are not supported in the local fixture backend. Export without --include-assets.');
    server ||= await defaultServer();
    if (!server) throw new Error('This Svelte export needs its target: pass --server <origin>.');
    project.export_options = { ...project.export_options, include_records: includeRecords };
    root = await exportStaticProject(project, target, serverOrigin(server));
  } else root = await exportWorkspace(project, target, { includeRecords, includeAssets });
  let install = null;
  if (svelte) {
    try { await access(join(root, 'package-lock.json')); install = 'npm ci'; }
    catch { install = 'npm install'; }
  }
  return { ok: true, runtime: svelte ? 'svelte-vite' : 'companion', directory: root, project_id: project.id, ...(server ? { server } : {}), include_records: includeRecords, install,
    message: `Exported ${project.name || 'app'} to ${root}.${svelte ? `\nIn that folder, run ${install}, then tinykit dev. Sign-in is shared with your other projects on this server.` : '\nRun tinykit dev from that folder.'}` };
}
