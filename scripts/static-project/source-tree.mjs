import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const directories = ['src', 'tinykit', 'scripts'];
/** @typedef {{format_version: number, files: Record<string, string>}} SourceBundle */
const rootFiles = ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'svelte.config.js', 'svelte.config.mjs', 'jsconfig.json', 'tsconfig.json', '.gitignore', '.nvmrc', 'README.md', 'AGENTS.md', 'instructions.md'];
/** @param {string} name */
const excluded = name => name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(name);
const MAX_BYTES = 5 * 1024 * 1024;
/** @param {string} value */
const hash = value => createHash('sha256').update(value).digest('hex');

/** @param {string} name */
function validPath(name) {
  if (typeof name !== 'string' || name.length > 240 || name.includes('\\')) return false;
  if (rootFiles.includes(name)) return true;
  const parts = name.split('/');
  return directories.includes(parts[0]) && parts.length > 1 && parts.slice(1).every(part => !excluded(part) && /^[A-Za-z0-9_@()-][A-Za-z0-9_.@() -]*$/.test(part));
}

// Files are base64 so imported images and exact UTF-8/newline bytes survive.
// This is a project-source format, never an archive of the working directory.
/** @param {any} bundle @returns {SourceBundle} */
export function validateSourceBundle(bundle) {
  if (!bundle || bundle.format_version !== 1 || Object.keys(bundle).some(key => !['format_version', 'files'].includes(key)) || !bundle.files || Array.isArray(bundle.files) || typeof bundle.files !== 'object') throw new Error('Invalid source bundle.');
  const names = Object.keys(bundle.files).sort(), seen = new Set();
  if (!names.length || names.length > 500) throw new Error('Source bundle must contain 1–500 files.');
  let total = 0;
  /** @type {Record<string, string>} */
  const files = {};
  for (const name of names) {
    const value = bundle.files[name];
    if (!validPath(name) || seen.has(name.toLowerCase())) throw new Error(`Invalid or colliding source path: ${name}`);
    if (typeof value !== 'string' || value.length > MAX_BYTES * 4 / 3 + 4) throw new Error(`Invalid source file: ${name}`);
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value) throw new Error(`Invalid source encoding: ${name}`);
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error('Source tree exceeds 5 MB.');
    seen.add(name.toLowerCase()); files[name] = value;
  }
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/').toLowerCase())) throw new Error(`Source file is also a directory: ${name}`);
  }
  for (const name of ['src/App.svelte', 'package.json', 'index.html']) if (!Object.hasOwn(files, name)) throw new Error(`Source bundle is missing ${name}.`);
  return { format_version: 1, files };
}

/** @param {string | undefined} frontend @param {SourceBundle | null | undefined} [bundle] */
export function sourceHash(frontend, bundle) {
  // Keep the initial single-file baseline compatible with existing exports.
  return bundle ? hash(JSON.stringify({ frontend_code: frontend || '', source_bundle: validateSourceBundle(bundle) })) : hash(frontend || '');
}

/** @param {string} root */
export async function readSourceTree(root) {
  /** @type {Record<string, string>} */
  const files = {};
  let size = 0, count = 0;
  /** @param {string} name */
  async function collect(name, optional = false) {
    let info;
    try { info = await lstat(join(root, name)); }
    catch (error) { if (optional && error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${name}`);
    if (info.isDirectory()) {
      for (const child of await readdir(join(root, name))) if (!excluded(child)) await collect(`${name}/${child}`);
    } else if (info.isFile()) {
      size += info.size; count++;
      if (size > MAX_BYTES || count > 500) throw new Error('Source tree exceeds 5 MB or 500 files.');
      if (!validPath(name) || info.size > MAX_BYTES) throw new Error(`Unsupported source file: ${name}`);
      files[name] = (await readFile(join(root, name))).toString('base64');
    } else throw new Error(`Unsupported source entry: ${name}`);
  }
  for (const name of [...rootFiles, ...directories]) await collect(name, true);
  return validateSourceBundle({ format_version: 1, files });
}

/** @param {string} root @param {SourceBundle} bundle */
export async function writeSourceTree(root, bundle) {
  const validated = validateSourceBundle(bundle);
  for (const [name, value] of Object.entries(validated.files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), Buffer.from(value, 'base64'));
  }
}

/** @param {string} root @returns {import('vite').Plugin} */
export function sourceSnapshotPlugin(root) {
  let initial = '';
  return {
    name: 'tinykit-build-source', apply: 'build',
    async buildStart() {
      const bundle = await readSourceTree(root);
      initial = sourceHash(Buffer.from(bundle.files['src/App.svelte'], 'base64').toString('utf8'), bundle);
    },
    async writeBundle() {
      const bundle = await readSourceTree(root);
      const current = sourceHash(Buffer.from(bundle.files['src/App.svelte'], 'base64').toString('utf8'), bundle);
      if (current !== initial) throw new Error('Source changed during the build. Build again before publishing.');
      await mkdir(join(root, '.tinykit'), { recursive: true });
      await writeFile(join(root, '.tinykit/build-source.json'), JSON.stringify({ source_hash: current }));
    }
  };
}
