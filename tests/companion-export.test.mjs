import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import definitions from '../pocketbase/pb_hooks/lib/definitions.cjs';
import { sourceHash, validateSourceBundle } from '../scripts/static-project/source-tree.mjs';

function exportRoute({ authenticated, project, assetStatus = 200, projectDenied = false }) {
  const source = readFileSync(new URL('../src/routes/api/projects/[id]/export/+server.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  const imports = {
    '../../../../../../scripts/static-project/source-tree.mjs': { sourceHash, validateSourceBundle },
    'node:crypto': { createHash },
    'node:module': { createRequire: () => () => definitions },
    '../../../../../../pocketbase/pb_hooks/lib/definitions.cjs': { default: definitions },
    'pocketbase': { default: class {
      authStore = { save() {} };
      files = { getToken: async () => 'fixture-file-token', getURL: (_project, name, options) => { assert.equal(options.token, 'fixture-file-token'); return `https://asset.example/${name}`; } };
      collection() { return { getOne: async () => { assert.ok(authenticated, 'must authenticate before project access'); if (projectDenied) throw { status: 403 }; return project; } }; }
    } },
    '@sveltejs/kit': { json: (data, init) => Response.json(data, init) },
    '$lib/server/pb': {
      validateUserToken: async () => authenticated ? { id: 'user' } : null,
      unauthorizedResponse: message => Response.json({ error: message }, { status: 401 }),
      pb: { files: { getURL: (_project, name) => `https://asset.example/${name}` } }
    }
  };
  vm.runInNewContext(outputText, { exports, require: name => imports[name], process: { cwd: () => '/app' }, Buffer, URL, console: { error() {} }, fetch: async () => new Response('asset bytes', { status: assetStatus }) });
  return exports.GET;
}

test('export requires user authentication before reading project data', async () => {
  const GET = exportRoute({ authenticated: false });
  assert.equal((await GET({ params: { id: 'app' }, request: new Request('http://localhost/export') })).status, 401);
});

test('authenticated export contains portable assets and backend source without service secrets', async () => {
  const project = { id: 'app', name: 'App', frontend_code: '<h1>Hello</h1>', backend_code: '// backend', data: {}, assets: ['hello.png'], settings: { token: 'secret' }, agent_chat: ['private'] };
  const GET = exportRoute({ authenticated: true, project });
  const response = await GET({ params: { id: 'app' }, request: new Request('http://localhost/export?include_assets=1&include_records=1', { headers: { Authorization: 'Bearer test-token' } }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(result.backend_code, '// backend');
  assert.equal(Buffer.from(result.asset_files[0].base64, 'base64').toString(), 'asset bytes');
  assert.equal(result.settings, undefined);
  assert.equal(result.agent_chat, undefined);
});

test('missing assets fail the export instead of silently producing a broken app', async () => {
  const GET = exportRoute({ authenticated: true, project: { assets: ['missing.png'] }, assetStatus: 404 });
  assert.equal((await GET({ params: { id: 'app' }, request: new Request('http://localhost/export?include_assets=1', { headers: { Authorization: 'Bearer test-token' } }) })).status, 500);
});

test('default export excludes live records and user uploads while retaining schemas', async () => {
  const GET = exportRoute({ authenticated: true, project: { data: { notes: { schema: [{ name: 'title', type: 'text' }], records: [{ title: 'private' }] } }, assets: ['private.png'] }, assetStatus: 500 });
  const response = await GET({ params: { id: 'app' }, request: new Request('http://localhost/export', { headers: { Authorization: 'Bearer test-token' } }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data.notes.records, []);
  assert.equal(result.data.notes.schema[0].name, 'title');
  assert.deepEqual(result.asset_files, []);
  assert.deepEqual(result.assets, []);
  assert.equal(result.omitted_assets, 1);
});

test('authenticated users still need permission to view the exported project', async () => {
  const GET = exportRoute({ authenticated: true, projectDenied: true });
  const response = await GET({ params: { id: 'app' }, request: new Request('http://localhost/export', { headers: { Authorization: 'Bearer test-token' } }) });
  assert.equal(response.status, 403);
});
