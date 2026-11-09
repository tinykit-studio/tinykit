import { mkdtemp, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import ts from 'typescript';
import { marked } from 'marked';
import contract from '../../pocketbase/pb_hooks/lib/definitions.cjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const escapeHTML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export async function buildHostedDefinition(definition, projectId, revision, { localAssets = {} } = {}) {
  contract.validate(definition);
  if (!/^[a-z0-9]{15}$/.test(projectId) || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid hosted build identity.');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-publish-')));
  try {
    // Use only Tinykit's installed compiler/dependencies, never a project Vite
    // config or package script. Compilation does not execute the app on the host.
    await symlink(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    const generatorSource = await readFile(join(packageRoot, 'src/routes/tinykit/lib/module-generators.ts'), 'utf8');
    const compiled = ts.transpileModule(generatorSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    const generators = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
    const assets = Object.fromEntries(Object.entries(definition.assets).map(([name, asset]) => [name, localAssets[name] || `/_tk/source-assets/${projectId}/${asset.digest}/${encodeURIComponent(name)}`]));
    const content = {};
    for (const field of definition.content) {
      const key = field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let value = field.value;
      if (field.type === 'image' && value && !/^https?:/.test(value)) value = assets[value] || `/_tk/assets/${projectId}/${value}`;
      if (field.type === 'markdown' && value) value = marked.parse(value);
      content[key] = value;
    }
    await writeFile(join(root, 'content.js'), `export default ${JSON.stringify(content)};`);
    await writeFile(join(root, 'design.js'), `export default ${JSON.stringify(Object.fromEntries(definition.design.map(field => [field.css_var, field.value])))};`);
    await writeFile(join(root, 'data.js'), generators.generate_data_module(projectId, Object.keys(definition.schema)));
    const tinykit = `const SOURCE_ASSETS = ${JSON.stringify(assets)};\n` + generators.generate_tinykit_module(projectId).replace("  let url = '/_tk/assets/' + PROJECT_ID + '/' + filename", "  let url = SOURCE_ASSETS[filename] || '/_tk/assets/' + PROJECT_ID + '/' + filename");
    await writeFile(join(root, 'tinykit.js'), tinykit);
    let source = definition.frontend_code.replace(/<style(\s+global)(\s[^>]*)?>([^]*?)<\/style>/gi, (_, global, attrs, css) => `<style${attrs || ''}>:global {${css}}</style>`);
    for (const [name, url] of Object.entries(assets)) source = source.split(`/_tk/assets/${projectId}/${name}`).join(url);
    await writeFile(join(root, 'App.svelte'), source);
    await writeFile(join(root, 'main.js'), "import { mount } from 'svelte'; import App from './App.svelte'; mount(App, { target: document.getElementById('app') });");
    const css = definition.design.filter(field => /^--[\w-]+$/.test(field.css_var)).map(field => `${field.css_var}:${field.value}`).join(';').replace(/<\/style/gi, '');
    const fonts = [...new Set(definition.design.filter(field => field.type === 'font' && /^[\w -]+$/.test(field.value)).map(field => `${field.value.toLowerCase().replace(/\s+/g, '-')}:400,500,600,700`))];
    const fontLink = fonts.length ? `<link rel="stylesheet" href="https://fonts.bunny.net/css?family=${encodeURIComponent(fonts.join('|'))}&display=swap">` : '';
    await writeFile(join(root, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="tinykit-definition" content="${revision}"><title>${escapeHTML(definition.name)}</title>${fontLink}<style>*,::before,::after{box-sizing:border-box}:root{${css}}body{margin:0}button,input,select,textarea{font:inherit}</style></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>`);
    const result = await build({
      root, configFile: false, envFile: false, envPrefix: 'TINYKIT_PUBLIC_UNUSED_', publicDir: false, logLevel: 'error',
      plugins: [svelte({ configFile: false, dynamicCompileOptions: ({ filename }) => filename === join(root, 'App.svelte') ? { runes: true } : undefined })],
      resolve: { dedupe: ['svelte'], alias: { $content: join(root, 'content.js'), $design: join(root, 'design.js'), $data: join(root, 'data.js'), $tinykit: join(root, 'tinykit.js') } },
      build: { write: false, target: 'es2022', assetsInlineLimit: Infinity, cssCodeSplit: false, rollupOptions: { external: id => /^https:\/\//.test(id), output: { inlineDynamicImports: true } } }
    });
    const output = result.output;
    let html = output.find(file => file.fileName === 'index.html')?.source;
    if (typeof html !== 'string') throw new Error('Compiler did not produce an HTML entrypoint.');
    const consumed = new Set(['index.html']);
    html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, path) => {
      const filename = path.replace(/^\//, ''), chunk = output.find(file => file.fileName === filename);
      if (!chunk?.code) throw new Error(`Unpackaged script: ${path}`);
      consumed.add(filename);
      return `<script type="module" src="data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}"></script>`;
    });
    html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g, (match, path) => {
      if (/^https:/.test(path)) return match;
      const filename = path.replace(/^\//, ''), asset = output.find(file => file.fileName === filename);
      if (!asset?.source) throw new Error(`Unpackaged stylesheet: ${path}`);
      consumed.add(filename);
      return `<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(asset.source).toString('base64')}">`;
    });
    for (const file of output) if (!consumed.has(file.fileName)) throw new Error(`Unpackaged build file: ${file.fileName}`);
    return html;
  } finally { await rm(root, { recursive: true, force: true }); }
}
