import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { exportStaticProject, findPackageImports } from '../scripts/static-project/export.mjs';
import { packageBuild, publish } from '../scripts/static-project/publish.mjs';
import { readSourceTree, sourceHash, sourceSnapshotPlugin, validateSourceBundle } from '../scripts/static-project/source-tree.mjs';
import { localBackend } from '../scripts/static-project/local-backend.mjs';

const project = { id: '123456789abcdef', name: 'Bookmarks', frontend_code: '<h1>Hello</h1>', content: [{ name: 'App Title', value: 'Bookmarks', type: 'text' }], design: [{ css_var: '--accent', value: 'blue' }], data: { bookmarks: { schema: [{ name: 'title', type: 'text' }], records: [{ id: 'seed', title: 'Seed' }] } }, settings: { secret: 'never-export' }, agent_chat: ['private-chat'] };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tinykit-static-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'app');
  await exportStaticProject({ ...project, export_options: { include_records: true } }, root, 'http://127.0.0.1:5173');
  return { root, directory };
}
function middleware(root) {
  let handler;
  localBackend(root, { project_id: project.id }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  return (path, method = 'GET', body, origin) => new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    req.url = path; req.method = method;
    req.headers = { host: '127.0.0.1:5180', 'content-type': 'application/json', ...(origin ? { origin } : {}) };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(text) { resolve({ status: this.status, body: JSON.parse(text), headers: this.headers }); } };
    handler(req, res, () => reject(new Error('Unexpected middleware fallthrough')));
  });
}
const dataPath = `/_tk/data/${project.id}/bookmarks`;

test('export discovers package roots in static and dynamic imports without reading comments or local paths', () => {
  const source = `<script lang="ts">
    // import Fake from 'not-a-dependency';
    import type { Editor } from '@tiptap/core';
    export { Underline } from '@tiptap/extension-underline';
    import { fly } from 'svelte/transition';
    const icon = import('@iconify/svelte');
    const local = import('./local.js');
    const data = import('$data');
    const remote = import('https://esm.sh/remote');
    const variable = import(packageName);
    const text = "import Thing from 'also-not-a-dependency'";
  </script>`;
  assert.deepEqual(findPackageImports(source), ['@tiptap/core', '@tiptap/extension-underline', 'svelte', '@iconify/svelte']);
});

test('every catalog app exports its imports, fields, schemas, and selected records', async t => {
  const filename = new URL('../src/lib/templates/index.ts', import.meta.url);
  const output = ts.transpileModule(await readFile(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const catalog = {};
  const templates = new Map();
  for (const [, name] of output.matchAll(/require\("([^"\n]+\.json)"\)/g)) templates.set(name, JSON.parse(await readFile(new URL(name, filename), 'utf8')));
  runInNewContext(output, { exports: catalog, require: name => templates.get(name) });
  const directory = await mkdtemp(join(tmpdir(), 'tinykit-catalog-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const template of catalog.TEMPLATES) await t.test(template.name, async () => {
    const root = join(directory, template.id);
    await exportStaticProject({ ...template, id: project.id, export_options: { include_records: true } }, root, 'http://127.0.0.1:5173');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const name of findPackageImports(template.frontend_code)) assert.ok(manifest.dependencies[name], `${template.name} is missing ${name}`);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'content.json'), 'utf8')), template.content || []);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'design.json'), 'utf8')), template.design || []);
    const schemas = JSON.parse(await readFile(join(root, 'schema.json'), 'utf8'));
    const seeds = JSON.parse(await readFile(join(root, 'seeds.json'), 'utf8'));
    for (const [name, collection] of Object.entries(template.data || {})) {
      assert.deepEqual(schemas[name], collection.schema || []);
      assert.deepEqual(seeds[name], collection.records || []);
    }
    if (template.id === 'notes') for (const name of ['@tiptap/core', '@tiptap/starter-kit', '@tiptap/extension-underline', '@tiptap/extension-link']) assert.equal(manifest.dependencies[name], '2.27.2');
  });
});

test('exported page titles use the app name and safely display HTML characters', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tinykit-export-title-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const root = join(directory, 'app');
  await exportStaticProject({...project,name:'Recipes & <shared>'},root,'http://127.0.0.1:5173');
  const html = await readFile(join(root,'index.html'),'utf8');
  assert.match(html,/<title>Recipes &amp; &lt;shared&gt;<\/title>/);
  assert.doesNotMatch(html,/<title>Bookmarks<\/title>|<shared>/);
});

test('Svelte export is independent, excludes private settings, and never overwrites a folder', async t => {
  const { root } = await fixture(t);
  const manifest = JSON.parse(await readFile(join(root, 'package.json')));
  assert.equal(manifest.scripts.build, 'vite build');
  assert.ok(manifest.dependencies.svelte);
  const config = JSON.parse(await readFile(join(root, 'tinykit.json')));
  assert.equal(config.project_id, project.id);
  assert.match(config.source_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(await readFile(join(root, 'tinykit/data.js'), 'utf8'), /never-export|private-chat/);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'seeds.json'))).bookmarks, project.data.bookmarks.records);
  await assert.rejects(exportStaticProject(project, root, config.server), /EEXIST/);
  assert.equal(await readFile(join(root, 'src/App.svelte'), 'utf8'), project.frontend_code);
});

test('fixture CRUD persists across restarts and source/seed edits; concurrent writes are retained', async t => {
  const { root } = await fixture(t);
  const request = middleware(root);
  assert.equal((await request(dataPath)).body.totalItems, 1);
  const results = await Promise.all(['One', 'Two'].map(title => request(dataPath, 'POST', { title })));
  assert.deepEqual(results.map(r => r.status), [201, 201]);
  const id = results[0].body.id;
  await writeFile(join(root, 'seeds.json'), JSON.stringify({ bookmarks: [] }));
  await writeFile(join(root, 'src/App.svelte'), '<h1>Edited</h1>');
  const restarted = middleware(root);
  assert.equal((await restarted(dataPath)).body.totalItems, 3);
  assert.equal((await restarted(`${dataPath}/${id}`, 'PATCH', { title: 'Edited record', id: 'wrong' })).body.id, id);
  assert.equal((await restarted(`${dataPath}/${id}`)).body.title, 'Edited record');
  assert.equal((await restarted(`${dataPath}/${id}`, 'DELETE')).status, 200);
  assert.equal((await restarted(`${dataPath}/${id}`)).status, 404);
});

test('local fields refresh independently; project boundary and origin checks prevent stray writes', async t => {
  const { root } = await fixture(t);
  const request = middleware(root);
  await writeFile(join(root, 'content.json'), JSON.stringify([{ name: 'App Title', value: 'Changed locally' }]));
  const fields = await request(`/_tk/config/${project.id}`);
  assert.deepEqual(fields.body, { content: { app_title: 'Changed locally' }, design: { '--accent': 'blue' } });
  assert.equal((await request(dataPath, 'POST', { title: 'Denied' }, 'https://other.example')).status, 403);
  assert.equal((await request('/_tk/data/anotherproject/bookmarks', 'POST', {})).status, 404);
  assert.equal((await request(`/_tk/data/${project.id}/missing`, 'POST', {})).status, 404);
  assert.equal((await request(`${dataPath}?filter=x`)).status, 400);
  assert.equal((await request(dataPath)).body.totalItems, 1);
});

test('packaging preserves script bytes and rejects missing assets and files escaping dist', async t => {
  const { root, directory } = await fixture(t);
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  const js = 'console.log("</script>");';
  await writeFile(join(dist, 'index.html'), '<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">');
  await writeFile(join(dist, 'assets/app.js'), js);
  await writeFile(join(dist, 'assets/app.css'), 'body{color:red}');
  const html = await packageBuild(root);
  assert.equal(Buffer.from(html.match(/data:text\/javascript;base64,([^"]+)/)[1], 'base64').toString(), js);
  assert.doesNotMatch(html, /\.\/assets\//);
  await writeFile(join(dist, 'unpacked.png'), 'image');
  await assert.rejects(packageBuild(root), /Unpackaged build file/);
  await rm(join(dist, 'unpacked.png'));
  await rm(join(dist, 'assets/app.js'));
  await writeFile(join(directory, 'outside.js'), 'private');
  await symlink(join(directory, 'outside.js'), join(dist, 'assets/app.js'));
  await assert.rejects(packageBuild(root), /escapes dist/);
});

test('realtime echo arriving before create response does not duplicate the record', async () => {
  const source = await readFile(new URL('../src/routes/tinykit/lib/module-generators.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { generate_data_module } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const record = { id: 'created', title: 'New' };
  const context = { console, window: {}, EventSource: class { addEventListener() {} }, URLSearchParams };
  context.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      context.window.__tk_update_data({ bookmarks: [record] });
      return { ok: true, json: async () => record };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
  runInNewContext(generate_data_module(project.id, ['bookmarks']).replace('export default db', 'globalThis.db = db'), context);
  await context.db.bookmarks.list();
  const counts = [];
  context.db.bookmarks._notify([]);
  const unsubscribe = context.db.bookmarks.subscribe(rows => counts.push(rows.length));
  await new Promise(resolve => setImmediate(resolve));
  await context.db.bookmarks.create({ title: record.title });
  assert.equal(counts.at(-1), 1);
  unsubscribe();
});

test('publish preserves exact source bytes across repeated uploads and rejects unauthenticated, denied, or stale writes', async () => {
  const source = await readFile(new URL('../src/routes/api/projects/[id]/build/+server.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = structuredClone(project);
  let authorized = true, denied = false, writes = 0;
  const imports = {
    '../../../../../../scripts/static-project/source-tree.mjs': { sourceHash, validateSourceBundle },
    'node:crypto': { createHash },
    '@sveltejs/kit': { json: (value, init) => Response.json(value, init) },
    '$lib/server/pb': { pb: { baseURL: 'http://localhost:8091' }, validateUserToken: async () => authorized ? { id: 'builder' } : null, unauthorizedResponse: () => new Response(null, { status: 401 }) },
    pocketbase: { default: class {
      authStore = { save(token) { assert.equal(token, 'test-token'); } };
      collection() { return {
        getOne: async () => { if (denied) throw { status: 403 }; return record; },
        update: async (_id, data) => {
          // Exercise real multipart encoding: ordinary text values would
          // normalize LF to CRLF, breaking the next revision comparison.
          const decoded = await new Request('http://localhost', { method: 'POST', body: data }).formData();
          assert.deepEqual([...decoded.keys()].sort(), ['@jsonPayload', 'published_html']);
          Object.assign(record, JSON.parse(decoded.get('@jsonPayload')));
          writes++;
        }
      }; }
    } }
  };
  const exports = {};
  runInNewContext(compiled, { exports, require: name => imports[name], Buffer, Blob, FormData, console });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const next = '<script>\nconst value = "hello";\n</script>\n<h1>{value}</h1>\n';
  const request = (expected_source_hash, source_bundle) => exports.POST({ params: { id: project.id }, request: new Request('http://localhost/build', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ html: '<h1>Built</h1>', frontend_code: next, source_bundle, expected_source_hash }) }) });
  authorized = false;
  assert.equal((await request(hash(record.frontend_code))).status, 401);
  authorized = true; denied = true;
  assert.equal((await request(hash(record.frontend_code))).status, 403);
  denied = false;
  assert.equal((await request('stale')).status, 409);
  assert.equal(writes, 0);
  assert.equal((await request(hash(record.frontend_code))).status, 200);
  assert.equal(record.frontend_code, next);
  assert.equal((await request(hash(next))).status, 200);
  assert.equal(writes, 2);
  assert.deepEqual(record.data, project.data);
  assert.deepEqual(record.content, project.content);
  assert.deepEqual(record.design, project.design);
  assert.deepEqual(record.settings, project.settings);
  const bundle = { format_version: 1, files: Object.fromEntries(Object.entries({ 'src/App.svelte': next, 'src/Child.svelte': '<p>Child</p>', 'package.json': '{}', 'index.html': '<!doctype html>' }).map(([name, text]) => [name, Buffer.from(text).toString('base64')])) };
  // An old server schema must not silently discard a source tree.
  assert.equal((await request(hash(next), bundle)).status, 409);
  record.source_bundle = null;
  assert.equal((await request(hash(next), bundle)).status, 200);
  assert.deepEqual(record.source_bundle, bundle);
  const bundleHash = sourceHash(next, bundle);
  assert.equal((await request(bundleHash)).status, 409);
  assert.equal((await request(bundleHash, { ...bundle, files: { ...bundle.files, '../outside': 'YQ==' } })).status, 400);
  record.source_bundle.files['src/Child.svelte'] = Buffer.from('<p>Changed on the server</p>').toString('base64');
  assert.equal((await request(bundleHash, bundle)).status, 409);
  assert.equal(writes, 3);
});

test('nested components, helpers, binary imports and package lock round-trip byte-for-byte without private files', async t => {
  const { root, directory } = await fixture(t);
  await mkdir(join(root, 'src/components/nested'), { recursive: true });
  await writeFile(join(root, 'src/components/nested/Card.svelte'), '<h2>Child\r\ncomponent</h2>');
  await writeFile(join(root, 'src/helpers.ts'), 'export const title: string = "Hello";\n');
  await writeFile(join(root, 'src/logo.png'), Buffer.from([137, 80, 78, 71, 0, 255]));
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=never-export');
  await mkdir(join(root, '.tinykit'), { recursive: true });
  await writeFile(join(root, '.tinykit/credentials.json'), 'never-export');
  const bundle = await readSourceTree(root);
  assert.ok(bundle.files['src/components/nested/Card.svelte']);
  assert.ok(bundle.files['package-lock.json']);
  assert.ok(!bundle.files['seeds.json']);
  assert.doesNotMatch(JSON.stringify(bundle), /credentials|\.env|\.tinykit/);
  const destination = join(directory, 'restored');
  const source_hash = sourceHash(project.frontend_code, bundle);
  await exportStaticProject({ ...project, source_bundle: bundle, source_hash }, destination, 'http://127.0.0.1:5173');
  assert.deepEqual(await readSourceTree(destination), bundle);
  assert.equal(JSON.parse(await readFile(join(destination, 'tinykit.json'))).source_hash, source_hash);
  assert.deepEqual(await readFile(join(destination, 'src/logo.png')), Buffer.from([137, 80, 78, 71, 0, 255]));
  // Source file deletion is preserved too; restore does not regenerate files
  // from an older scaffold over a saved project.
  delete bundle.files['src/main.js'];
  await exportStaticProject({ ...project, source_bundle: bundle }, join(directory, 'without-main'), 'http://127.0.0.1:5173');
  await assert.rejects(readFile(join(directory, 'without-main/src/main.js')), /ENOENT/);
});

test('source hashing detects a child-only edit and validation rejects traversal, private paths, collisions and symlinks', async t => {
  const { root, directory } = await fixture(t);
  const bundle = await readSourceTree(root);
  const before = sourceHash(project.frontend_code, bundle);
  bundle.files['src/Child.svelte'] = Buffer.from('<h1>Child</h1>').toString('base64');
  assert.notEqual(sourceHash(project.frontend_code, bundle), before);
  for (const name of ['../outside', '/src/Bad.svelte', 'src/../outside', 'src/.env', '.tinykit/credentials.json', 'src\\outside', 'seeds.json']) {
    assert.throws(() => validateSourceBundle({ ...bundle, files: { ...bundle.files, [name]: 'YQ==' } }), /Invalid/);
  }
  assert.throws(() => validateSourceBundle({ ...bundle, files: { ...bundle.files, 'src/child.svelte': 'YQ==' } }), /colliding/);
  assert.throws(() => validateSourceBundle({ ...bundle, files: { ...bundle.files, 'src/a': 'YQ==', 'src/a/b.js': 'YQ==' } }), /also a directory/);
  await writeFile(join(directory, 'outside'), 'private');
  await symlink(join(directory, 'outside'), join(root, 'src/linked.js'));
  await assert.rejects(readSourceTree(root), /symlinks/);
});

test('publication refuses a child edit after build before contacting the server', async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><h1>Built</h1>');
  const plugin = sourceSnapshotPlugin(root);
  await plugin.buildStart();
  await plugin.writeBundle();
  await writeFile(join(root, 'src/Child.svelte'), '<p>Edited after build</p>');
  const originalToken = process.env.TINYKIT_TOKEN;
  const originalFetch = globalThis.fetch;
  t.after(() => { if (originalToken === undefined) delete process.env.TINYKIT_TOKEN; else process.env.TINYKIT_TOKEN = originalToken; globalThis.fetch = originalFetch; });
  process.env.TINYKIT_TOKEN = 'test-token';
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  await assert.rejects(publish(root), /Source changed after the build/);
  await assert.rejects(plugin.writeBundle(), /Source changed during the build/);
});
