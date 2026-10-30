import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { portableProject } from '../companion/workspace.mjs';
import { sourceHash, validateSourceBundle, writeSourceTree } from './source-tree.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const templates = fileURLToPath(new URL('./', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const editorVersions = Object.fromEntries(['@tiptap/core', '@tiptap/starter-kit', '@tiptap/extension-underline', '@tiptap/extension-link'].map(name => [name, '2.27.2']));

export function findPackageImports(source) {
  const packages = new Set();
  const add = specifier => {
    if (!specifier || /^(?:[.$/#]|[a-z][a-z\d+.-]*:)/i.test(specifier)) return;
    packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
  };
  for (const [, script] of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const ast = ts.createSourceFile('App.ts', script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...packages];
}

export async function exportStaticProject(project, directory, server) {
  if (!/^[a-z0-9]{15}$/.test(project.id || '')) throw new Error('Export an existing Tinykit project with a valid ID.');
  const url = new URL(server);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw new Error('Server must be a bare HTTP(S) origin.');
  const files = portableProject(project);
  const schema = JSON.parse(files['schema.json']);
  if (Object.keys(schema).some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Invalid collection name.');
  if (project.assets?.length) throw new Error('This bookmarks spike does not export uploaded assets yet.');
  const sourceBundle = project.source_bundle ? validateSourceBundle(project.source_bundle) : null;
  const generatorSource = await readFile(join(packageRoot, 'src/routes/tinykit/lib/module-generators.ts'), 'utf8');
  const compiled = ts.transpileModule(generatorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const generators = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const version = async name => JSON.parse(await readFile(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
  const dependencies = {};
  if (!sourceBundle) for (const name of new Set(['svelte', '@iconify/svelte', 'marked', ...findPackageImports(project.frontend_code)])) {
    dependencies[name] = editorVersions[name] || await version(name).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return '*';
      throw error;
    });
  }
  const config = { format_version: 2, name: project.name, project_id: project.id, server: url.origin, source_hash: project.source_hash || sourceHash(project.frontend_code, sourceBundle) };
  const root = resolve(directory);
  await mkdir(root);
  try {
    for (const folder of ['src', 'tinykit', 'scripts']) await mkdir(join(root, folder));
    await writeFile(join(root, 'tinykit.json'), json(config));
    for (const name of ['content.json', 'design.json', 'schema.json', 'seeds.json', 'instructions.md']) await writeFile(join(root, name), files[name]);
    if (sourceBundle) {
      sourceBundle.files['src/App.svelte'] = Buffer.from(project.frontend_code).toString('base64');
      await writeSourceTree(root, sourceBundle);
      return root;
    }
    await writeFile(join(root, 'src/App.svelte'), project.frontend_code.replace(/<style\s+global\s*>([\s\S]*?)<\/style>/gi, '<style>:global {$1}</style>'));
    await writeFile(join(root, 'tinykit/data.js'), generators.generate_data_module(project.id, Object.keys(schema)));
    await writeFile(join(root, 'tinykit/helpers.js'), generators.generate_tinykit_module(project.id)
      .replace("return '/api/proxy?url=' + encodeURIComponent(url)", "return import.meta.env.DEV ? url : '/api/proxy?url=' + encodeURIComponent(url)")
      .replace("  const proxy_url = '/api/proxy?url='", "  if (import.meta.env.DEV) throw new Error('URL metadata is available on the published Tinykit app.');\n  const proxy_url = '/api/proxy?url='"));
    await copyFile(join(templates, 'runtime.svelte.js'), join(root, 'tinykit/runtime.svelte.js'));
    await copyFile(join(templates, 'local-backend.mjs'), join(root, 'tinykit/local-backend.mjs'));
    await copyFile(join(templates, 'publish.mjs'), join(root, 'scripts/publish.mjs'));
    await copyFile(join(templates, 'source-tree.mjs'), join(root, 'scripts/source-tree.mjs'));
    await writeFile(join(root, 'tinykit/content.js'), "export { content as default } from './runtime.svelte.js';\n");
    await writeFile(join(root, 'tinykit/design.js'), "export { design as default } from './runtime.svelte.js';\n");
    await writeFile(join(root, 'src/main.js'), `import { mount } from 'svelte';
import App from './App.svelte';
import { refreshFields, watchFields } from '../tinykit/runtime.svelte.js';
import './global.css';

async function start() {
  const target = document.getElementById('app');
  try {
    await refreshFields();
    target.replaceChildren();
    mount(App, { target });
    const stop = watchFields();
    window.addEventListener('pagehide', stop, { once: true });
  } catch (error) {
    const message = document.createElement('p');
    message.textContent = error.message;
    const retry = document.createElement('button');
    retry.textContent = 'Try again';
    retry.onclick = start;
    target.replaceChildren(message, retry);
  }
}
start();
`);
    await writeFile(join(root, 'src/global.css'), '* { box-sizing: border-box; }\nbody { margin: 0; font-family: var(--body-font, system-ui, sans-serif); }\nbutton, input, select, textarea { font: inherit; }\na { color: inherit; text-decoration: none; }\n');
    await writeFile(join(root, 'index.html'), '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escapeHTML(project.name || 'Tinykit app') + '</title></head><body><div id="app">Loading…</div><script type="module" src="/src/main.js"></script></body></html>\n');
    await writeFile(join(root, 'vite.config.js'), `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import config from './tinykit.json' with { type: 'json' };
import { localBackend } from './tinykit/local-backend.mjs';
import { sourceSnapshotPlugin } from './scripts/source-tree.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  base: './',
  plugins: [svelte(), localBackend(root, config), sourceSnapshotPlugin(root)],
  resolve: { alias: Object.fromEntries(['content', 'design', 'data', 'tinykit'].map(name => ['$' + name, fileURLToPath(new URL('./tinykit/' + (name === 'tinykit' ? 'helpers' : name) + '.js', import.meta.url))])) },
  server: { host: '127.0.0.1', port: 5180, strictPort: true,
    fs: { deny: ['.env', '.env.*', '**/.tinykit/**', '**/.git/**'] } },
  build: { cssCodeSplit: false, assetsInlineLimit: 10000000, sourcemap: false, rollupOptions: { output: { inlineDynamicImports: true } } }
});
`);
    await writeFile(join(root, 'package.json'), json({ name: 'tinykit-bookmarks', version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview --host 127.0.0.1', publish: 'npm run build && node scripts/publish.mjs' }, engines: { node: '>=22' }, dependencies, devDependencies: { vite: await version('vite'), '@sveltejs/vite-plugin-svelte': await version('@sveltejs/vite-plugin-svelte') } }));
    await writeFile(join(root, '.gitignore'), 'node_modules/\ndist/\n.tinykit/\n.env\n.env.*\n');
    await writeFile(join(root, '.nvmrc'), '22\n');
    await copyFile(join(templates, 'AGENTS.template.md'), join(root, 'AGENTS.md'));
    await copyFile(join(templates, 'README.template.md'), join(root, 'README.md'));
    return root;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [input, directory, server] = process.argv.slice(2);
    if (!input || !directory || !server) throw new Error('Usage: node scripts/static-project/export.mjs <export.json> <new-directory> <server-origin>');
    console.log(await exportStaticProject(JSON.parse(await readFile(input, 'utf8')), directory, server));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
