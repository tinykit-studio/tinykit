import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, stat, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { login, logout, getToken, defaultServer } from '../scripts/companion/auth.mjs';
import { parseExportArgs, exportProject } from '../scripts/export-project.mjs';
import { componentConfig, componentCommand, componentStatus } from '../scripts/static-project/cli.mjs';
import { readSourceTree, sourceSnapshotPlugin } from '../scripts/static-project/source-tree.mjs';
import { publish } from '../scripts/static-project/publish.mjs';

const server = 'http://127.0.0.1:5173';
const project = { id: '123456789abcdef', name: 'CLI app', frontend_code: '<h1>Hello</h1>', content: [], design: [], data: { notes: { schema: [], records: [{ id: 'live', title: 'Keep hosted' }] } }, settings: { secret: 'never-export' } };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tinykit-cli-test-'));
  const previousFetch = globalThis.fetch;
  const environment = Object.fromEntries(['TINYKIT_CONFIG_DIR', 'TINYKIT_TOKEN', 'TINYKIT_TOKEN_FILE'].map(key => [key, process.env[key]]));
  process.env.TINYKIT_CONFIG_DIR = join(directory, 'auth');
  delete process.env.TINYKIT_TOKEN; delete process.env.TINYKIT_TOKEN_FILE;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('sign-in is private, shared across project folders, and bound to each server', async t => {
  const directory = await fixture(t);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).password, 'test-password');
    assert.equal(options.redirect, 'error');
    return Response.json({ token: 'private-test-token' });
  };
  const result = await login({ server, email: 'test@example.com', password: 'test-password' });
  assert.doesNotMatch(JSON.stringify(result), /private-test-token|test-password/);
  assert.equal(await getToken(server, { root: join(directory, 'new-unexported-app') }), 'private-test-token');
  assert.equal(await defaultServer(), server);
  assert.equal((await stat(join(directory, 'auth/credentials.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, 'auth'))).mode & 0o777, 0o700);
  await assert.rejects(getToken('https://different.example'), /Sign in/);
  globalThis.fetch = async () => Response.json({ token: 'second-private-token' });
  await login({ server: 'https://second.example', email: 'test@example.com', password: 'test-password' });
  assert.equal(await getToken(server), 'private-test-token');
  assert.equal(await getToken('https://second.example'), 'second-private-token');
  await logout('https://second.example');
  assert.equal(await defaultServer(), server);
  await assert.rejects(getToken('https://second.example'), /Sign in/);
});

test('interactive login returns to the shell with the input stream still open', { timeout: 5000 }, async t => {
  await fixture(t);
  const script = `
    import assert from 'node:assert/strict';
    import { login } from ${JSON.stringify(new URL('../scripts/companion/auth.mjs', import.meta.url).href)};
    process.stdin.isTTY = true;
    process.stdin.setRawMode = raw => { process.stdin.isRaw = raw; };
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).password, 'test-password');
      return Response.json({ token: 'test-token' });
    };
    const result = await login({ server: ${JSON.stringify(server)}, email: 'test@example.com' });
    assert.equal(process.stdin.isRaw, false);
    console.log(result.message);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { signal: t.signal });
  t.after(() => child.kill());
  let output = '', sent = false, errors = '';
  child.stdout.setEncoding('utf8').on('data', chunk => {
    output += chunk;
    if (!sent && output.includes('Password: ')) {
      sent = true;
      // Leave stdin open, as a real terminal does after the password is entered.
      child.stdin.write('test-password\n');
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
  assert.deepEqual(await once(child, 'close'), [0, null], errors);
  assert.match(output, /Signed in to/);
  assert.doesNotMatch(output, /test-password/);
});

test('environment tokens and older app-local credentials remain supported without crossing server bindings', async t => {
  const directory = await fixture(t);
  const root = join(directory, 'app');
  await mkdir(join(root, '.tinykit'), { recursive: true });
  await writeFile(join(root, '.tinykit/credentials.json'), JSON.stringify({ server, token: 'legacy-token' }));
  assert.equal(await getToken(server, { root }), 'legacy-token');
  await assert.rejects(getToken('https://different.example', { root }), /Sign in/);
  process.env.TINYKIT_TOKEN = 'automation-token';
  assert.equal(await getToken(server), 'automation-token');
  delete process.env.TINYKIT_TOKEN;
  await mkdir(join(directory, 'other-auth'));
  await symlink(join(directory, 'other-auth'), join(directory, 'auth'));
  await assert.rejects(getToken(server, { root }), /symlinks/);
});

test('export arguments retain flag values and reject ambiguous or incomplete commands', () => {
  const options = parseExportArgs([project.id, './my-app', '--server', server, '--include-records', '--json']);
  assert.deepEqual(options.paths, [project.id, './my-app']);
  assert.equal(options.server, server);
  assert.equal(options.includeRecords, true);
  for (const args of [[project.id], [project.id, 'app', '--server'], [project.id, 'app', '--unknown'], [project.id, 'app', 'extra']]) assert.throws(() => parseExportArgs(args));
});

test('direct export creates a Svelte project using saved sign-in and leaves records out unless requested', async t => {
  const directory = await fixture(t);
  globalThis.fetch = async (url, options) => {
    if (url.includes('auth-with-password')) return Response.json({ token: 'private-test-token' });
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    assert.equal(options.redirect, 'error');
    // Even a response with records must respect the caller's inclusion choice.
    return Response.json({ ...project, export_options: { include_records: true } });
  };
  await login({ server, email: 'test@example.com', password: 'test-password' });
  const root = join(directory, 'app');
  const exported = await exportProject(parseExportArgs([project.id, root]));
  assert.equal(exported.runtime, 'svelte-vite');
  assert.equal((await componentConfig(root)).config.server, server);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'seeds.json'))).notes, []);
  assert.doesNotMatch(JSON.stringify(await readSourceTree(root)), /private-test-token|never-export/);
  assert.equal((await componentStatus(root)).build.state, 'missing');
  await assert.rejects(exportProject(parseExportArgs([project.id, root])), /already exists/);
  const withRecords = join(directory, 'with-records');
  await exportProject(parseExportArgs([project.id, withRecords, '--include-records']));
  assert.equal(JSON.parse(await readFile(join(withRecords, 'seeds.json'))).notes.length, 1);
  globalThis.fetch = async () => Response.json({ ...project, source_hash: 'different-on-server' });
  await assert.rejects(componentCommand('publish', await componentConfig(root), { json: true }), /Hosted source changed/);
});

test('legacy downloaded JSON keeps its companion format; component JSON is restored as a normal project', async t => {
  const directory = await fixture(t);
  const file = join(directory, 'export.json');
  await writeFile(file, JSON.stringify(project));
  const legacy = await exportProject(parseExportArgs([file, join(directory, 'legacy')]));
  assert.equal(legacy.runtime, 'companion');
  assert.equal(await componentConfig(legacy.directory), null);
  const converted = await exportProject(parseExportArgs([file, join(directory, 'svelte'), '--svelte', '--server', server]));
  const bundle = await readSourceTree(converted.directory);
  await writeFile(file, JSON.stringify({ ...project, source_bundle: bundle, hosted: { server } }));
  const restored = await exportProject(parseExportArgs([file, join(directory, 'restored')]));
  assert.deepEqual(await readSourceTree(restored.directory), bundle);
});

test('a lost upload response reports an unknown outcome and keeps the local baseline', async t => {
  const directory = await fixture(t), file = join(directory, 'export.json'), root = join(directory, 'app');
  await writeFile(file, JSON.stringify(project));
  await exportProject(parseExportArgs([file, root, '--svelte', '--server', server]));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><h1>Built</h1>');
  const plugin = sourceSnapshotPlugin(root);
  await plugin.buildStart(); await plugin.writeBundle();
  const before = JSON.parse(await readFile(join(root, 'tinykit.json')));
  for (const transport of ['disconnected', 'truncated-json']) {
    globalThis.fetch = async (_url, options) => {
      if (!options.method) return Response.json({ ...project, source_hash: before.source_hash });
      if (transport === 'disconnected') throw new Error('Connection lost');
      return new Response('{', { status: 200 });
    };
    await assert.rejects(publish(root, { token: 'test-token', log: false }), error => error.publish?.state === 'unknown');
    assert.equal(JSON.parse(await readFile(join(root, 'tinykit.json'))).source_hash, before.source_hash);
  }
});
