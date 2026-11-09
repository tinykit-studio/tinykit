// @ts-nocheck
import { mkdir, readFile, writeFile, rename, realpath, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const sourceFiles = ['tinykit.json', 'App.svelte', 'backend.js', 'content.json', 'design.json', 'schema.json', 'seeds.json', 'instructions.md'];
const json = value => JSON.stringify(value, null, 2) + '\n';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function portableProject(project, { includeRecords = project?.export_options?.include_records === true } = {}) {
  if (!object(project) || typeof project.frontend_code !== 'string') throw new Error('Expected a Tinykit project export with frontend_code.');
  const schema = {}, seeds = {};
  for (const [name, collection] of Object.entries(project.data || {})) {
    schema[name] = Array.isArray(collection) ? [] : collection.schema || [];
    seeds[name] = includeRecords ? (Array.isArray(collection) ? collection : collection.records || []) : [];
  }
  return {
    'tinykit.json': json({ format_version: 1, name: project.name || 'My app', project_id: /^[a-z0-9]{15}$/.test(project.id || '') ? project.id : 'tinykitlocalapp', ...(project.visibility ? { visibility: project.visibility } : {}), ...(project.local_first ? { local_first: true } : {}), ...(project.hosted ? { hosted: project.hosted } : {}) }),
    'App.svelte': project.frontend_code,
    'backend.js': project.backend_code || '',
    'content.json': json(project.content || []),
    'design.json': json(project.design || []),
    'schema.json': json(schema),
    'seeds.json': json(seeds),
    'instructions.md': project.custom_instructions || '',
    '.gitignore': '.tinykit/\n',
    'AGENTS.md': '# Tinykit local app\n\nRun `tinykit dev` from this directory. Edit App.svelte, content.json, design.json, and schema.json; the companion updates automatically. Use Svelte 5. Tinykit imports $content, $design, and $data are available. Read instructions.md for project-specific guidance.\n\nSource files are authoritative. Edit source in files; use the companion to preview and publish. Do not edit .tinykit/; it contains local runtime data and diagnostics. seeds.json initializes new local collections only; editing source does not reset existing records. assets/ contains flat asset filenames. backend.js is preserved for portability but is not executed by this milestone. Relative component imports are not supported yet. Use `tinykit login`, `tinykit push`, and `tinykit publish` for an upgraded hosted instance. Push/publication never upload seeds or local runtime records. Review hosted source conflicts before linking a new baseline; do not bypass them.\n\nRun `tinykit status --json` for current-revision import and compilation status. Browser compilation requires an open companion preview; pending is not success. .tinykit/status.json contains import/syntax diagnostics and .tinykit/compile.json contains browser reports. Runtime errors appear in the companion.\n'
  };
}

export function safeAssetName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name)) throw new Error('Invalid asset filename.');
  return name;
}

export async function readWorkspaceFile(root, name) {
  const base = await realpath(root);
  const target = await realpath(join(base, name));
  if (!target.startsWith(base + sep)) throw new Error(`${name}: symlinks outside the app folder are not allowed.`);
  return readFile(target);
}

export async function exportWorkspace(project, directory, options = {}) {
  if (project.source_bundle) throw new Error('This app has multiple source files. Export it with scripts/static-project/export.mjs to preserve its Svelte project.');
  const files = portableProject(project, options);
  const includeAssets = options.includeAssets ?? project?.export_options?.include_assets === true;
  if (!Array.isArray(project.source_asset_files || []) || !Array.isArray(project.asset_files || [])) throw new Error('Asset files must be arrays.');
  const combined = new Map((includeAssets ? project.asset_files || [] : []).map(asset => [asset.name, asset]));
  for (const asset of project.source_asset_files || []) combined.set(asset.name, asset);
  const assets = [...combined.values()];
  const names = new Set();
  for (const asset of assets) {
    safeAssetName(asset.name);
    if (names.has(asset.name) || typeof asset.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64)) throw new Error('Invalid or duplicate exported asset.');
    names.add(asset.name);
  }
  if (includeAssets && (project.assets || []).some(name => !names.has(name))) throw new Error('Export is missing asset files. Download a fresh export from Tinykit Studio with uploaded files included.');
  const root = resolve(directory);
  // Refuse existing folders; a partial export must never overwrite local source.
  await mkdir(root);
  try {
    await mkdir(join(root, 'assets'));
    for (const [name, contents] of Object.entries(files)) await writeFile(join(root, name), contents, { flag: 'wx' });
    for (const asset of assets) await writeFile(join(root, 'assets', asset.name), Buffer.from(asset.base64, 'base64'), { flag: 'wx' });
    await readWorkspace(root);
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function readWorkspace(root) {
  const raw = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, (await readWorkspaceFile(root, name)).toString('utf8')])));
  const parse = name => {
    try { return JSON.parse(raw[name]); } catch (error) { throw new Error(`${name}: ${error.message}`); }
  };
  const config = parse('tinykit.json');
  if (config.format_version !== 1 || typeof config.name !== 'string' || !config.name.trim() || !/^[a-z0-9]{15}$/.test(config.project_id)) throw new Error('tinykit.json: expected format_version 1, a name, and a 15-character project_id.');
  const content = parse('content.json'), design = parse('design.json'), schema = parse('schema.json'), seeds = parse('seeds.json');
  for (const [name, fields] of [['content.json', content], ['design.json', design]]) {
    if (!Array.isArray(fields) || fields.some(field => !object(field) || typeof field.name !== 'string' || typeof field.type !== 'string')) throw new Error(`${name}: expected an array of field definitions with name and type.`);
  }
  if (!object(schema) || !object(seeds)) throw new Error('schema.json and seeds.json must be objects keyed by collection name.');
  for (const [name, fields] of Object.entries(schema)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || !Array.isArray(fields) || fields.some(field => !object(field) || typeof field.name !== 'string' || typeof field.type !== 'string')) throw new Error(`schema.json: invalid collection ${name}.`);
    if (seeds[name] !== undefined && (!Array.isArray(seeds[name]) || seeds[name].some(row => !object(row)))) throw new Error(`seeds.json: ${name} must contain an array of records.`);
  }
  const assets = [];
  for (const entry of (await readdir(join(root, 'assets'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    safeAssetName(entry.name);
    if (entry.isDirectory()) throw new Error('assets/: use flat filenames in this milestone.');
    const bytes = await readWorkspaceFile(root, join('assets', entry.name));
    assets.push([entry.name, createHash('sha256').update(bytes).digest('hex')]);
  }
  const revision = createHash('sha256').update(JSON.stringify({ raw, assets })).digest('hex');
  const assetRevision = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
  return { config, revision, assetRevision, schema, seeds, project: { name: config.name, frontend_code: raw['App.svelte'], backend_code: raw['backend.js'], custom_instructions: raw['instructions.md'], content, design } };
}

// Only source-owned schemas change on reimport. Runtime rows survive every edit.
export function mergeLocalData(current, schema, seeds) {
  const data = { ...current };
  for (const [name, fields] of Object.entries(schema)) {
    const prior = data[name];
    data[name] = { schema: fields, records: prior ? (Array.isArray(prior) ? prior : prior.records || []) : (seeds[name] || []) };
  }
  return data;
}

export async function writeAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, json(value), { mode: 0o600 });
  await rename(temporary, path);
}
