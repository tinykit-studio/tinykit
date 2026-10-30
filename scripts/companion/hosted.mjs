import { readFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readWorkspace, readWorkspaceFile, writeAtomic } from './workspace.mjs';
import { claimWorkspace } from './dev.mjs';
import { buildHostedDefinition } from './build.mjs';
import contract from '../../pocketbase/pb_hooks/lib/definitions.cjs';
import { getToken, defaultServer, login as loginToServer } from './auth.mjs';
import { bootstrapHostedApp } from './bootstrap.mjs';

export function serverOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Server must be a bare HTTP(S) origin.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote Tinykit connections require HTTPS.');
  return url.origin;
}

export function parseHostedArgs(args) {
  const options = { directory: '.', json: false, publish: false };
  let directory = false;
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--server' || value === '--project' || value === '--email') { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${value} needs a value.`); options[value.slice(2)] = args[++i]; }
    else if (value === '--json') options.json = true;
    else if (value === '--publish') options.publish = true;
    else if (value.startsWith('-') || directory) throw new Error(`Unknown argument: ${value}`);
    else { directory = true; options.directory = value; }
  }
  return options;
}

async function credentials(root, server) { return getToken(server, { root }); }

export async function hostedCommand(command, options) {
  const root = await realpath(options.directory);
  const config = JSON.parse((await readWorkspaceFile(root, 'tinykit.json')).toString('utf8'));
  const runtime = join(root, '.tinykit');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await realpath(runtime) !== runtime) throw new Error('.tinykit must not be a symlink.');
  const statePath = join(runtime, 'remote.json');
  let baseline;
  try { baseline = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  baseline ||= config.hosted;
  if(config.local_first && !baseline && !options.server && command==='push')throw new Error('Choose the destination for this app’s first publication with --server <origin>. No hosted target was created.');
  const configuredServer = options.server || baseline?.server || await defaultServer();
  if (!configuredServer) throw new Error('Set --server <origin>, or use an app exported from the updated hosted server.');
  const server = serverOrigin(configuredServer);
  const projectId = options.project || baseline?.project_id || config.project_id;
  if (!/^[a-z0-9]{15}$/.test(projectId)) throw new Error('A valid --project ID is required.');
  if (command === 'login') return loginToServer({ server, email: options.email, password: options.password, root });

  const token = await credentials(root, server);
  const endpoint = `${server}/api/projects/${projectId}`;
  async function request(path, body) {
    const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || `Tinykit request failed (${response.status}). ${response.status === 404 ? 'Upgrade the hosted server with the CLI migrations and hooks.' : ''}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  const status = async () => {
    const result = await request('/hosted');
    if (result.protocol !== 1) throw new Error('Hosted server does not support this workflow. Upgrade it first.');
    return result;
  };
  const saveBaseline = async remote => {
    baseline = { server, project_id: projectId, base_revision: remote.base_revision, draft_revision: remote.draft?.revision || null };
    await writeAtomic(statePath, baseline);
  };
  if (command === 'remote-status') {
    const remote = await status();
    return { ok: true, server, project_id: projectId, base_revision: remote.base_revision, draft_revision: remote.draft?.revision || null, published_revision: remote.publication?.revision || null, published_at: remote.publication?.published_at || null, public_url: server + remote.public_path };
  }
  if (command === 'review') {
    const remote = await status();
    // Only counts cross into the review UI; row contents stay on the host.
    let live_data_summary = null;
    try {
      const response = await fetch(`${server}/_pb/api/collections/_tk_projects/records/${projectId}?fields=data`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const project = await response.json();
        const collections = Object.entries(project.data || {}).map(([name, value]) => ({ name, count: Array.isArray(value) ? value.length : Array.isArray(value?.records) ? value.records.length : 0 }));
        live_data_summary = { collections, total: collections.reduce((sum, collection) => sum + collection.count, 0) };
      }
    } catch { /* Older or restricted hosts can still publish without a count. */ }
    const workspace = await readWorkspace(root);
    const assets = {};
    for (const name of (await readdir(join(root, 'assets'))).filter(name => !name.startsWith('.'))) {
      const bytes = await readWorkspaceFile(root, join('assets', name));
      assets[name] = createHash('sha256').update(bytes.toString('base64')).digest('hex');
    }
    const local = { ...workspace.project, schema: workspace.schema, assets };
    const files = { 'App.svelte': 'frontend_code', 'backend.js': 'backend_code', 'content.json': 'content', 'design.json': 'design', 'schema.json': 'schema', 'instructions.md': 'custom_instructions', 'App name': 'name', 'assets/': 'assets' };
    const text = (definition, field) => {
      let value = definition?.[field];
      if (field === 'assets' && definition !== local) value = Object.fromEntries(Object.entries(value || {}).map(([name, asset]) => [name, asset.digest]));
      return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(JSON.parse(contract.canonical(value)), null, 2);
    };
    const changes = Object.entries(files).map(([file, field]) => ({ file, local: text(local, field), hosted: text(remote.draft?.definition || remote.definition, field), source: text(remote.definition, field), published: text(remote.publication?.definition, field) }));
    const linked = Boolean(baseline?.server === server && baseline?.project_id === projectId && baseline?.base_revision);
    const conflict = linked && (baseline.base_revision !== remote.base_revision || (baseline.draft_revision || null) !== (remote.draft?.revision || null));
    return { ok: true, server, project_id: projectId, linked, conflict, visibility: remote.visibility || 'public', live_data_summary, review: { local_revision: workspace.revision, base_revision: remote.base_revision, draft_revision: remote.draft?.revision || null }, changes,
      draft_revision: remote.draft?.revision || null, published_revision: remote.publication?.revision || null,
      draft_stale: Boolean(remote.draft && remote.draft.base_revision !== remote.base_revision && remote.publication?.revision !== remote.draft.revision),
      published_at: remote.publication?.published_at || null, public_url: server + remote.public_path };
  }
  const release = await claimWorkspace(runtime, 'hosted.lock');
  let pushResult, publishResult, publishAttempted = false;
  try {
    if(!baseline && config.local_first && command==='push') {
      if(projectId!==config.project_id)throw new Error('First publication must use this local app’s own project ID.');
      baseline=await bootstrapHostedApp(root,config,server,request);
      await writeAtomic(statePath,baseline);
      console.error('First publication starts with empty hosted records. Local records and samples stay in this workspace.');
    }
    if (options.review) {
      const current = await status();
      if (current.base_revision !== options.review.base_revision || (current.draft?.revision || null) !== options.review.draft_revision || (await readWorkspace(root)).revision !== options.review.local_revision) throw new Error('Files or hosted source changed since your review. Refresh the review before continuing.');
    }
    if (command === 'link') {
      const remote = await status();
      if (options.review && (remote.base_revision !== options.review.base_revision || (remote.draft?.revision || null) !== options.review.draft_revision)) throw new Error('Hosted source changed since your review. Refresh before linking.');
      await saveBaseline(remote);
      return { ok: true, server, project_id: projectId, base_revision: remote.base_revision, message: 'Linked to the current hosted source. Review hosted source changes before replacing its draft.' };
    }
    if (!baseline || baseline.server !== server || baseline.project_id !== projectId || !baseline.base_revision) throw new Error('No baseline for this hosted app. Export it from the updated server, or run tinykit link --server <origin> --project <id> after reviewing hosted changes.');
    if (command === 'push') {
      const workspace = await readWorkspace(root);
      if (options.review && workspace.revision !== options.review.local_revision) throw new Error('Local files changed since your review. Refresh before pushing.');
      const definition = { ...workspace.project, schema: workspace.schema, assets: {} };
      contract.validate(definition);
      const asset_files = [];
      let size = 0;
      for (const entry of await readdir(join(root, 'assets'), { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        contract.assetName(entry.name);
        const bytes = await readWorkspaceFile(root, join('assets', entry.name));
        size += bytes.length;
        if (size > 6000000) throw new Error('Source assets exceed the 6 MB push limit.');
        asset_files.push({ name: entry.name, base64: bytes.toString('base64') });
      }
      if ((await readWorkspace(root)).revision !== workspace.revision) throw new Error('Local files changed while preparing the push. Save them and run push again.');
      const request_id = randomUUID();
      let saved;
      try { saved = await request('/draft', { definition, asset_files, expected_base_revision: baseline.base_revision, expected_draft_revision: baseline.draft_revision || null, request_id }); }
      catch (error) {
        if (error.status) throw error;
        const remote = await status().catch(() => null);
        if (remote?.draft?.request_id !== request_id) {
          const unknown = new Error('Push outcome is unknown. Check tinykit remote-status before retrying.'); unknown.push = { state: 'unknown', request_id }; throw unknown;
        }
        saved = { draft: remote.draft };
      }
      // Preserve the saved draft's identity even if another client changes it
      // between saving and this status read; the next push must then conflict.
      pushResult = { state: 'succeeded', revision: saved.draft.revision };
      await saveBaseline({ draft: saved.draft, base_revision: saved.draft.base_revision });
      if (!options.publish) return { ok: true, server, project_id: projectId, push: pushResult, publish: { state: 'not_requested' }, message: 'Hosted draft saved. Live records were preserved.' };
    }
    if (command === 'publish' || options.publish) {
      publishAttempted = true;
      const remote = await status();
      if (!remote.draft) throw new Error('No hosted draft exists. Run tinykit push first.');
      if (remote.base_revision !== baseline.base_revision || remote.draft.revision !== baseline.draft_revision) throw new Error('Hosted source or draft changed. Review it before publishing.');
      if (remote.publication?.revision === remote.draft.revision) {
        if (remote.publication.base_revision !== remote.base_revision) throw new Error('Hosted source changed after publication. Push the reviewed source before publishing again.');
        return { ok: true, push: pushResult, publish: { state: 'succeeded', revision: remote.publication.revision, already_published: true }, public_url: server + remote.public_path };
      }
      if (remote.draft.base_revision !== remote.base_revision) throw new Error('Hosted source changed after the draft was saved. Push the reviewed source before publishing.');
      let html;
      try { html = await buildHostedDefinition(remote.draft.definition, projectId, remote.draft.revision); }
      catch (error) { throw new Error(`Build failed; the hosted draft is saved and the prior public app is unchanged. Fix the source and push it, then retry tinykit publish. ${error.message}`); }
      const attempt_id = randomUUID();
      let published;
      try { published = await request('/publish', { html, draft_revision: remote.draft.revision, attempt_id }); }
      catch (error) {
        if (error.status) throw error;
        const checked = await status().catch(() => null);
        if (checked?.publication?.attempt_id !== attempt_id) {
          const unknown = new Error('Publish outcome is unknown. Check tinykit remote-status before retrying.'); unknown.publish = { state: 'unknown', attempt_id }; throw unknown;
        }
        published = { publication: checked.publication };
      }
      publishResult = { state: 'succeeded', revision: published.publication.revision, attempt_id };
      await saveBaseline({ base_revision: published.publication.base_revision, draft: remote.draft });
      return { ok: true, server, project_id: projectId, push: pushResult, publish: publishResult, public_url: server + remote.public_path, message: 'Published. Live records and user uploads were preserved.' };
    }
    throw new Error(`Unknown hosted command: ${command}`);
  } catch (error) {
    error.push ||= pushResult;
    if (publishAttempted) error.publish ||= publishResult || { state: 'failed' };
    throw error;
  } finally { await release(); }
}
