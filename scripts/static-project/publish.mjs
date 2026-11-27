import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceTree, sourceHash } from './source-tree.mjs';

export async function packageBuild(root) {
  const dist = await realpath(join(root, 'dist'));
  let html = await readFile(join(dist, 'index.html'), 'utf8');
  const consumed = new Set(['index.html']);
  async function asset(name) {
    if (!name.startsWith('./assets/') || name.includes('..') || /[?#\\]/.test(name)) throw new Error(`Unsupported build reference: ${name}`);
    const path = await realpath(resolve(dist, name));
    if (!path.startsWith(dist + sep)) throw new Error('Build asset escapes dist/.');
    consumed.add(name.slice(2));
    return readFile(path);
  }
  for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]) {
    const bytes = await asset(match[1]);
    html = html.replace(match[0], `<script type="module" src="data:text/javascript;base64,${bytes.toString('base64')}"></script>`);
  }
  for (const match of [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)]) {
    const bytes = await asset(match[1]);
    html = html.replace(match[0], `<link rel="stylesheet" href="data:text/css;base64,${bytes.toString('base64')}">`);
  }
  async function check(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await check(join(directory, entry.name), `${name}/`);
      else if (!entry.isFile() || !consumed.has(name)) throw new Error(`Unpackaged build file: ${name}. This spike requires one JS bundle, one stylesheet, and inlined assets.`);
    }
  }
  await check(dist);
  if (/\b(?:src|href)="\.\//.test(html)) throw new Error('Unpackaged relative reference in HTML.');
  return html;
}

export async function publish(root, options = {}) {
  const config = JSON.parse(await readFile(join(root, 'tinykit.json'), 'utf8'));
  const origin = new URL(config.server);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !['http:', 'https:'].includes(origin.protocol)) throw new Error('tinykit.json server must be a bare HTTP(S) origin.');
  if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Remote publishing requires HTTPS.');
  if (!/^[a-z0-9]{15}$/.test(config.project_id)) throw new Error('Invalid project ID.');
  if (options.server && options.server !== origin.origin || options.project_id && options.project_id !== config.project_id) throw new Error('Publish target changed while building. Review tinykit.json and try again.');
  const token = options.token || process.env.TINYKIT_TOKEN || (process.env.TINYKIT_TOKEN_FILE ? (await readFile(process.env.TINYKIT_TOKEN_FILE, 'utf8')).trim() : '');
  if (!token) throw new Error('Set TINYKIT_TOKEN or TINYKIT_TOKEN_FILE to a Tinykit builder token. It is never included in the build.');
  const html = await packageBuild(root);
  const source = await readFile(join(root, 'src/App.svelte'), 'utf8');
  const source_bundle = await readSourceTree(root);
  const nextHash = sourceHash(source, source_bundle);
  const built = JSON.parse(await readFile(join(root, '.tinykit/build-source.json'), 'utf8').catch(() => { throw new Error('Build the project before publishing (npm run build).'); }));
  if (built.source_hash !== nextHash) throw new Error('Source changed after the build. Run npm run build before publishing.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const endpoint = `${origin.origin}/api/projects/${config.project_id}`;
  const before = await fetch(`${endpoint}/export`, { headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!before.ok) throw new Error(`Cannot read target project (${before.status}).`);
  const previous = await before.json();
  const previousHash = previous.source_hash || sourceHash(previous.frontend_code, previous.source_bundle);
  if (previousHash !== config.source_hash) throw new Error('The server source tree changed since export/publish. Export again and reconcile changes first.');
  await mkdir(join(root, '.tinykit'), { recursive: true });
  await writeFile(join(root, '.tinykit', 'before-publish.json'), JSON.stringify(previous, null, 2), { mode: 0o600 });
  let response;
  try { response = await fetch(`${endpoint}/build`, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(60000), body: JSON.stringify({ html, frontend_code: source, source_bundle, expected_source_hash: previousHash }) }); }
  catch {
    const error = new Error('Publish outcome is unknown. Run tinykit remote-status and check the app before retrying.');
    error.publish = { state: 'unknown', source_hash: nextHash };
    throw error;
  }
  if (!response.ok) throw new Error(`Publish failed (${response.status}): ${await response.text()}`);
  let result;
  try { result = await response.json(); }
  catch {
    const error = new Error('Publish outcome is unknown. Run tinykit remote-status and check the app before retrying.');
    error.publish = { state: 'unknown', source_hash: nextHash };
    throw error;
  }
  if (result.source_hash !== nextHash) throw new Error('Server did not confirm the source bundle. Upgrade Tinykit before publishing again.');
  config.format_version = 2;
  config.source_hash = nextHash;
  await writeFile(join(root, 'tinykit.json'), JSON.stringify(config, null, 2) + '\n');
  if (options.log !== false) (options.log || console.log)(`Published ${config.name}: ${origin.origin}/tinykit/preview/${config.project_id}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await publish(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
