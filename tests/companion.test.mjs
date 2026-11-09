import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportWorkspace, readWorkspace, mergeLocalData, safeAssetName, portableProject } from '../scripts/companion/workspace.mjs';
import { syntaxDiagnostic, claimWorkspace } from '../scripts/companion/dev.mjs';
import { compileStatus } from '../scripts/companion/status.mjs';

const project = { id: '123456789abcdef', name: 'Notes', frontend_code: '<h1>Hello</h1>', backend_code: '// preserved', content: [], design: [], data: { notes: { schema: [{ name: 'title', type: 'text' }], records: [{ id: 'note', title: 'Seed' }] } }, settings: { services: { secrets: { value: 'never-export' } } }, agent_chat: [{ content: 'private chat' }] };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tinykit-workspace-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'app');
  await exportWorkspace(project, root, { includeRecords: true });
  return { dir, root };
}

test('exports source and seeds, preserves identity, and excludes service credentials/history', async t => {
  const { root } = await fixture(t);
  const app = await readWorkspace(root);
  assert.equal(app.config.project_id, project.id);
  assert.equal(app.project.frontend_code, project.frontend_code);
  assert.equal(app.project.backend_code, project.backend_code);
  assert.deepEqual(app.seeds.notes, project.data.notes.records);
  assert.doesNotMatch(JSON.stringify(portableProject(project)), /never-export|private chat/);
  await assert.rejects(exportWorkspace({ ...project, frontend_code: 'changed' }, root), /EEXIST/);
  assert.equal((await readWorkspace(root)).project.frontend_code, project.frontend_code);
});

test('legacy JSON exports without IDs are usable', async t => {
  const { dir } = await fixture(t);
  const root = join(dir, 'legacy');
  await exportWorkspace({ ...project, id: undefined, data: { notes: [{ title: 'Old format' }] } }, root, { includeRecords: true });
  assert.deepEqual((await readWorkspace(root)).seeds.notes, [{ title: 'Old format' }]);
});

test('file edits change revisions; malformed JSON is actionable and recoverable', async t => {
  const { root } = await fixture(t);
  const initial = await readWorkspace(root);
  await writeFile(join(root, 'App.svelte'), '<h1>Changed</h1>');
  const changed = await readWorkspace(root);
  assert.notEqual(initial.revision, changed.revision);
  await writeFile(join(root, 'content.json'), '{');
  await assert.rejects(readWorkspace(root), /content.json:/);
  await writeFile(join(root, 'content.json'), '[]');
  assert.equal((await readWorkspace(root)).project.frontend_code, '<h1>Changed</h1>');
});

test('source imports retain local runtime rows and seed only new collections', () => {
  const current = { notes: { schema: [], records: [{ id: 'local', title: 'Created in preview' }] }, removed: { records: [{ id: 'keep' }] } };
  const next = mergeLocalData(current, { notes: [{ name: 'title', type: 'text' }], added: [] }, { notes: [{ id: 'seed' }], added: [{ id: 'new' }] });
  assert.deepEqual(next.notes.records, current.notes.records);
  assert.deepEqual(next.added.records, [{ id: 'new' }]);
  assert.deepEqual(next.removed, current.removed);
  assert.deepEqual(current.notes.schema, []);
});

test('portable assets survive export and changing bytes changes the revision', async t => {
  const { dir } = await fixture(t);
  const root = join(dir, 'assets-app');
  await exportWorkspace({ ...project, assets: ['hello.txt'], asset_files: [{ name: 'hello.txt', base64: Buffer.from('hello').toString('base64') }] }, root, { includeAssets: true });
  assert.equal(await readFile(join(root, 'assets/hello.txt'), 'utf8'), 'hello');
  const before = await readWorkspace(root);
  await writeFile(join(root, 'assets/hello.txt'), 'updated');
  assert.notEqual(before.revision, (await readWorkspace(root)).revision);
  await assert.rejects(exportWorkspace({ ...project, assets: ['missing.png'] }, join(dir, 'missing'), { includeAssets: true }), /missing asset files/);
});

test('rejects asset traversal and source symlinks outside the workspace', async t => {
  const { root, dir } = await fixture(t);
  for (const name of ['../secret', '..', 'a/b', 'a\\b', 'bad\0name']) assert.throws(() => safeAssetName(name));
  await writeFile(join(dir, 'outside'), 'secret');
  await rm(join(root, 'App.svelte'));
  await symlink(join(dir, 'outside'), join(root, 'App.svelte'));
  await assert.rejects(readWorkspace(root), /outside the app folder/);
});

test('syntax diagnostics include filename and location, then clear after correction', () => {
  const diagnostic = syntaxDiagnostic('<script>let count = ;</script><h1>{count}</h1>');
  assert.equal(diagnostic.file, 'App.svelte');
  assert.equal(diagnostic.line, 1);
  assert.ok(diagnostic.message);
  assert.equal(syntaxDiagnostic('<script>let count = $state(0);</script><h1>{count}</h1>'), null);
  assert.equal(syntaxDiagnostic('<style global>body { color: red; }</style>'), null);
});

test('workspace lock rejects duplicate processes and releases cleanly', async t => {
  const { root } = await fixture(t);
  const runtime = join(root, '.tinykit');
  await mkdir(runtime);
  const release = await claimWorkspace(runtime);
  await assert.rejects(claimWorkspace(runtime), /already has a dev process/);
  await release();
  const secondRelease = await claimWorkspace(runtime);
  await secondRelease();
});

test('portable source defaults to definitions, with records explicitly opted in', () => {
  assert.deepEqual(JSON.parse(portableProject(project)['seeds.json']).notes, []);
  assert.equal(JSON.parse(portableProject(project, { includeRecords: true })['seeds.json']).notes[0].title, 'Seed');
});

test('compile status never presents a result from an older revision or session as current', () => {
  const source = { session_id: 'session2', source_revision: 'rev2' };
  assert.equal(compileStatus(source, { revision: 'session1:rev2', state: 'success' }).state, 'pending');
  assert.equal(compileStatus(source, { revision: 'session2:rev1', state: 'success' }).state, 'pending');
  assert.equal(compileStatus(source, { revision: 'session2:rev2', state: 'success' }).state, 'success');
  assert.equal(compileStatus({ ...source, import_error: 'invalid JSON' }, { revision: 'session2:rev2', state: 'success' }).state, 'blocked');
});
