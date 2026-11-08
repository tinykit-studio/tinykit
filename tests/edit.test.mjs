import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEditArgs, editProject, resolveEditWorkspace, ensureEditPreview, stopEditPreview, openEditAgent } from '../scripts/edit-project.mjs';
import { exportStaticProject } from '../scripts/static-project/export.mjs';
import { readSourceTree } from '../scripts/static-project/source-tree.mjs';
import { localEditCommand, localEditLink } from '../src/lib/local-edit-command.js';
import { parseLocalEditLink, openLocalEditLink, launcherPlist } from '../scripts/local-launcher.mjs';

const id = '123456789abcdef', server = 'http://127.0.0.1:5173';
const supported = { skip: Number(process.versions.node.split('.')[0]) < 22 };
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-edit-')));
  const previous = process.env.TINYKIT_CONFIG_DIR;
  process.env.TINYKIT_CONFIG_DIR = join(directory, 'config');
  t.after(async () => { if (previous === undefined) delete process.env.TINYKIT_CONFIG_DIR; else process.env.TINYKIT_CONFIG_DIR = previous; await rm(directory, { recursive: true, force: true }); });
  const root = join(directory, "Bookmarks ' local");
  await exportStaticProject({ id, name: 'Bookmarks', frontend_code: '<h1>Bookmarks</h1>', content: [], design: [], data: {} }, root, server);
  return { root, directory };
}
test('Studio command and edit arguments preserve identity and reject unsafe targets', () => {
  assert.equal(localEditCommand(id, server), `tinykit edit ${id} --server '${server}'`);
  assert.equal(localEditCommand(id, server, true), `npm run tinykit -- edit ${id} --server '${server}'`);
  for (const origin of ['http://remote.example', 'https://user:password@example.com', 'https://example.com/path', 'javascript:alert(1)']) assert.throws(() => localEditCommand(id, origin));
  assert.throws(() => localEditCommand('$(bad)', server));
  const options = parseEditArgs([id, '--server', server, '--directory', './new-app', '--no-agent', '--json']);
  assert.equal(options.input, id); assert.equal(options.server, server); assert.equal(options.launch, false);
  for (const args of [['--unknown'], ['--server'], ['--agent','unknown'], ['one','two']]) assert.throws(() => parseEditArgs(args));
});
test('native links accept only server/project identity and round-trip Studio links', () => {
  const link = localEditLink(id, server), options = parseLocalEditLink(link);
  assert.equal(options.input, id); assert.equal(options.server, server);
  assert.equal(options.registeredOnly, true); assert.equal(options.launch, true);
  const invalid = [
    'https://edit?server=https://example.com&project=' + id,
    link + '&command=rm', link + '&directory=/tmp', link + '&project=' + id,
    link + '&server=https://other.example', link + '#fragment',
    link.replace('://edit', '://user@edit'), link.replace('://edit', '://edit:123'),
    link.replace('://edit', '://edit/path'), link.replace(id, '../x'),
    link.replace('127.0.0.1', 'remote.example'), link + '%',
    'tinykit://edit?project=' + id,
    'tinykit://edit?server=https%3A%2F%2Fuser%3Asecret%40example.com&project=' + id,
    'tinykit://edit?server=https%3A%2F%2Fexample.com%2Fpath&project=' + id,
  ];
  for (const value of invalid) assert.throws(() => parseLocalEditLink(value), value);
  assert.match(launcherPlist(), /CFBundleURLSchemes.*<string>tinykit<\/string>/s);
});
test('native handoff refuses unknown, mismatched and unprepared workspaces without exporting or installing', supported, async t => {
  const { root } = await fixture(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No network request is allowed.'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const link = localEditLink(id, server);
  await assert.rejects(openLocalEditLink(link), /not registered/);
  await editProject(parseEditArgs([root, '--register-only']));
  await assert.rejects(openLocalEditLink(localEditLink(id, 'https://other.example')), /not registered/);
  const agentStatus = async () => ({ available: true, app: '/Applications/ChatGPT.app' });
  await assert.rejects(openLocalEditLink(link, { agentStatus }), /needs dependencies/);
  await assert.rejects(access(join(root, 'node_modules')));
  const before = await readSourceTree(root);
  let opened = false;
  const result = await openLocalEditLink(link, { agentStatus, preview: async (_app, options) => {
    assert.equal(options.registeredOnly, true); return { url: 'http://127.0.0.1:5180', reused: true };
  }, openAgent: async () => { opened = true; } });
  assert.equal(opened, true); assert.equal(result.created, false); assert.equal(result.directory, root);
  assert.deepEqual(await readSourceTree(root), before);
  const configPath = join(root, 'tinykit.json');
  const config = JSON.parse(await readFile(configPath));
  await writeFile(configPath, JSON.stringify({ ...config, project_id: '987654321abcdef' }));
  await assert.rejects(openLocalEditLink(link, { agentStatus }), /different Tinykit/);
});
test('registering and reopening uses the exact local workspace without changing source', supported, async t => {
  const { root, directory } = await fixture(t);
  const before = await readSourceTree(root);
  await editProject(parseEditArgs([root, '--register-only']));
  const resolved = await resolveEditWorkspace(parseEditArgs([id, '--server', server]));
  assert.equal(resolved.root, root); assert.equal(resolved.created, false);
  await assert.rejects(resolveEditWorkspace(parseEditArgs([id, '--server', 'https://other.example', '--directory', root])), /different Tinykit/);
  await assert.rejects(resolveEditWorkspace(parseEditArgs([root, '--server','https://other.example'])), /different Tinykit/);
  assert.deepEqual(await readSourceTree(root), before);
  const saved = JSON.parse(await readFile(join(directory, 'config/workspaces.json')));
  assert.equal(saved.workspaces.length, 1); assert.equal(saved.workspaces[0].directory, root);
  await rm(root, { recursive: true });
  await assert.rejects(resolveEditWorkspace(parseEditArgs([id, '--server', server])), /moved or is incomplete/);
});
test('handoff passes folder as an argument, supplies preview context, and excludes hosting tokens', supported, async t => {
  const { root } = await fixture(t);
  const agent = { available: true, app: '/Applications/ChatGPT.app' };
  let launched;
  const before = await readSourceTree(root);
  const result = await editProject(parseEditArgs([root]), {
    agentStatus: async () => agent,
    preview: async () => ({ url: 'http://127.0.0.1:5180', reused: true }),
    openAgent: async () => openEditAgent(agent, root, await readFile(join(root, '.tinykit/edit-context.md'), 'utf8'), async (binary, args, options) => { launched = { binary, args, options }; })
  });
  assert.equal(result.agent_opened, true); assert.equal(result.preview_reused, true);
  assert.equal(launched.binary, '/usr/bin/open');
  assert.deepEqual(launched.args.slice(0, 2), ['-a', agent.app]);
  const link = new URL(launched.args[2]);
  assert.equal(link.protocol, 'codex:'); assert.equal(link.searchParams.get('path'), root);
  assert.match(link.searchParams.get('prompt'), /http:\/\/127.0.0.1:5180/);
  assert.equal(launched.options.env.TINYKIT_TOKEN, undefined); assert.equal(launched.options.env.TINYKIT_TOKEN_FILE, undefined);
  assert.match(await readFile(result.context_file, 'utf8'), /http:\/\/127.0.0.1:5180/);
  assert.deepEqual(await readSourceTree(root), before);
  await assert.rejects(editProject(parseEditArgs([root]), { agentStatus: async () => ({ available: false, message: 'Install Codex.' }) }), /Install Codex/);
});
test('workspace registry refuses symlinks and invalid saved identities', supported, async t => {
  const { root, directory } = await fixture(t);
  await editProject(parseEditArgs([root, '--register-only']));
  const path = join(directory, 'config/workspaces.json');
  await rm(path); await symlink(join(root, 'tinykit.json'), path);
  await assert.rejects(resolveEditWorkspace(parseEditArgs([id, '--server', server])), /symlink/);
  await rm(path); await writeFile(path, JSON.stringify({ format_version: 1, workspaces: [{ project_id: '../invalid', server, directory: root }] }));
  await assert.rejects(resolveEditWorkspace(parseEditArgs([id, '--server', server])), /Invalid workspace/);
});
test('a first handoff exports without records and subsequent handoffs retain local edits', supported, async t => {
  const { directory } = await fixture(t), target = join(directory, 'fresh-app');
  const previousFetch = globalThis.fetch, previousToken = process.env.TINYKIT_TOKEN;
  t.after(() => { globalThis.fetch = previousFetch; if (previousToken === undefined) delete process.env.TINYKIT_TOKEN; else process.env.TINYKIT_TOKEN = previousToken; });
  process.env.TINYKIT_TOKEN = 'temporary-test-token';
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(new URL(url).searchParams.get('include_records'), '0');
    assert.equal(options.headers.Authorization, 'Bearer temporary-test-token');
    return Response.json({ id, name: 'Fresh app', frontend_code: '<h1>Hosted source</h1>', data: { notes: { schema: [], records: [{ id: 'live', title: 'Hosted only' }] } }, content: [], design: [], export_options: { include_records: true } });
  };
  const options = parseEditArgs([id, '--server', server, '--directory', target, '--no-agent']);
  const adapters = { preview: async () => ({ url: 'http://127.0.0.1:5180', reused: false }) };
  assert.equal((await editProject(options, adapters)).created, true);
  assert.deepEqual(JSON.parse(await readFile(join(target, 'seeds.json'))).notes, []);
  await writeFile(join(target, 'src/App.svelte'), '<h1>Unpublished local changes</h1>');
  const reopened = await editProject(parseEditArgs([id, '--server', server, '--no-agent']), adapters);
  assert.equal(reopened.directory, target); assert.equal(reopened.created, false);
  assert.equal(requests, 1);
  assert.match(await readFile(join(target, 'src/App.svelte'), 'utf8'), /Unpublished local changes/);
});
test('edit starts an actual preview, reuses it, and rejects stale session metadata', { ...supported, skip: supported.skip || !process.env.TINYKIT_TEST_EDIT, timeout: 60000 }, async t => {
  const { root } = await fixture(t);
  const studio = fileURLToPath(new URL('../', import.meta.url));
  await symlink(join(studio, 'node_modules'), join(root, 'node_modules'), 'junction');
  const app = await resolveEditWorkspace(parseEditArgs([root]));
  let state;
  t.after(async () => {
    if (!state) return;
    process.kill(state.pid, 'SIGTERM');
    for (let i = 0; i < 100; i++) {
      try { await access(join(root, '.tinykit/dev-server.json')); } catch { return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('The test preview did not shut down.');
  });
  const first = await ensureEditPreview(app, { json: true });
  state = JSON.parse(await readFile(join(root, '.tinykit/dev-server.json')));
  assert.equal(first.reused, false); assert.equal((await fetch(first.url)).status, 200);
  const second = await ensureEditPreview(app, { json: true });
  assert.equal(second.url, first.url); assert.equal(second.reused, true);
  await writeFile(join(root, '.tinykit/dev-server.json'), JSON.stringify({ ...state, session: 'wrong-session' }));
  await assert.rejects(ensureEditPreview(app, { json: true }), /could not be verified/);
  await writeFile(join(root, '.tinykit/dev-server.json'), JSON.stringify(state));
  assert.equal((await stopEditPreview(app)).stopped, true);
  state = null;
  assert.equal((await stopEditPreview(app)).stopped, false);
});
