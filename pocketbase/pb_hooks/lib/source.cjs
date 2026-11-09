// PocketBase implementation of the static-project source format. Keep byte
// serialization compatible with scripts/static-project/source-tree.mjs; the
// publication integration test checks their hashes across both runtimes.
const directories = ['src', 'tinykit', 'scripts'];
/** @typedef {{format_version: number, files: Record<string, string>}} SourceBundle */
const rootFiles = ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'svelte.config.js', 'svelte.config.mjs', 'jsconfig.json', 'tsconfig.json', '.gitignore', '.nvmrc', 'README.md', 'AGENTS.md', 'instructions.md'];
/** @param {string} name */
const excluded = name => name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(name);
const MAX_BYTES = 5 * 1024 * 1024;

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
function validateSourceBundle(bundle) {
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
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`Invalid source encoding: ${name}`);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    if ((padding === 2 && alphabet.indexOf(value[value.length - 3]) % 16) || (padding === 1 && alphabet.indexOf(value[value.length - 2]) % 4)) throw new Error(`Invalid source encoding: ${name}`);
    total += value.length / 4 * 3 - padding;
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
function sourceText(frontend, bundle) {
  return bundle ? JSON.stringify({ frontend_code: frontend || '', source_bundle: validateSourceBundle(bundle) }) : frontend || '';
}
module.exports = { validateSourceBundle, sourceText };
