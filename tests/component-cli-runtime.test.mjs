import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import PocketBase from 'pocketbase';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const selected = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return selected;
}
async function ready(fn) {
  for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await delay(100); }
  throw new Error('Component CLI fixture did not become ready.');
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}

test('component CLI signs in once, exports, runs isolated data, publishes and detects failures/conflicts', { skip: !process.env.TINYKIT_TEST_COMPONENT_CLI, timeout: 180000 }, async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-component-cli-')));
  const pbPort = await port(), webPort = await port(), devPort = await port();
  const server = `http://127.0.0.1:${webPort}`, pbURL = `http://127.0.0.1:${pbPort}`;
  const email = 'component-fixture@localhost.test', password = 'temporary-component-test-password';
  const binary = join(root, 'pocketbase/pocketbase');
  const flags = ['--automigrate=false', '--dir', join(temporary, 'pb_data'), '--migrationsDir', join(root, 'pocketbase/pb_migrations'), '--hooksDir', join(root, 'pocketbase/pb_hooks')];
  let pbProcess, webProcess, devProcess, logs = '', phase = 'startup';
  const track = child => { child.stdout?.on('data', value => logs += value); child.stderr?.on('data', value => logs += value); return child; };
  t.after(async () => { for (const child of [devProcess, webProcess, pbProcess]) await stop(child); await rm(temporary, { recursive: true, force: true }); });
  try {
    await exec(binary, ['superuser', 'upsert', email, password, ...flags]);
    pbProcess = track(spawn(binary, ['serve', '--http', `127.0.0.1:${pbPort}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const pb = new PocketBase(pbURL); pb.autoCancellation(false);
    await ready(async () => (await pb.health.check()).code === 200);
    await pb.collection('_superusers').authWithPassword(email, password);
    await pb.collection('users').create({ email, password, passwordConfirm: password });
    const user = new PocketBase(pbURL), auth = await user.collection('users').authWithPassword(email, password);
    const id = '123456789abcdef';
    await pb.collection('_tk_projects').create({ id, name: 'Bookmarks CLI test', kit: 'custom', frontend_code: '<h1>Previous working app</h1>', backend_code: '// Keep backend', content: [{ name: 'App Title', type: 'text', value: 'Live bookmarks' }], design: [], data: { bookmarks: { schema: [{ name: 'title', type: 'text' }], records: ['One','Two','Three','Four'].map((title, i) => ({ id: `live${i}`, title })) } }, settings: { secret: 'keep-hosted-secret' } });
    const original = await pb.collection('_tk_projects').getOne(id);
    const env = { ...process.env, TINYKIT_CONFIG_DIR: join(temporary, 'auth'), TINYKIT_TOKEN: auth.token, POCKETBASE_URL: pbURL, POCKETBASE_ADMIN_EMAIL: email, POCKETBASE_ADMIN_PASSWORD: password, TINYKIT_SETUP_FILE: join(temporary, 'no-setup') };
    for (const key of ['TINYKIT_TOKEN_FILE','TINYKIT_COMPANION_DIR','TINYKIT_COMPANION_ID','TINYKIT_COMPANION_ORIGIN']) delete env[key];
    webProcess = track(spawn(process.execPath, ['scripts/companion/server.mjs', String(webPort)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    await ready(async () => (await fetch(`${server}/api/projects/${id}/export`, { headers: { Authorization: `Bearer ${auth.token}` } })).ok);
    const cli = async (...args) => JSON.parse((await exec(process.execPath, ['scripts/tinykit.mjs', ...args, '--json'], { cwd: root, env, maxBuffer: 3000000 })).stdout);
    phase = 'login';
    const signedIn = await cli('login', '--server', server);
    assert.equal(signedIn.ok, true);
    assert.doesNotMatch(JSON.stringify(signedIn), new RegExp(auth.token));
    delete env.TINYKIT_TOKEN;
    const app = join(temporary, 'bookmarks');
    phase = 'direct export';
    assert.equal((await cli('export', id, app, '--include-records')).runtime, 'svelte-vite');
    // Runtime tests reuse installed compiler dependencies. A separate manual
    // acceptance run installs the actual bookmarks lockfile into a fresh folder.
    await symlink(join(root, 'node_modules'), join(app, 'node_modules'), 'junction');
    phase = 'local dev';
    devProcess = track(spawn(process.execPath, ['scripts/tinykit.mjs', 'dev', app, '--port', String(devPort), '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    const dataURL = `http://127.0.0.1:${devPort}/_tk/data/${id}/bookmarks`;
    await ready(async () => (await fetch(dataURL)).ok);
    assert.equal((await (await fetch(dataURL)).json()).totalItems, 4);
    const local = await fetch(dataURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Local only' }) });
    assert.equal(local.status, 201);
    assert.equal((await cli('status', app)).running, true);
    await assert.rejects(cli('dev', app, '--port', String(devPort), '--no-open'));
    assert.equal((await fetch(dataURL)).status, 200, 'duplicate startup must not stop the active preview');
    await stop(devProcess);
    await assert.rejects(fetch(dataURL));
    await assert.rejects(access(join(app, '.tinykit/dev.lock')), /ENOENT/);
    assert.equal((await cli('status', app)).running, false);
    assert.equal((await pb.collection('_tk_projects').getOne(id)).data.bookmarks.records.length, 4);
    phase = 'component publication';
    await mkdir(join(app, 'src/components'));
    await writeFile(join(app, 'src/App.svelte'), '<script>import Child from "./components/Child.svelte"; import content from "$content";</script><Child title={content.app_title} />');
    const child = '<script>let { title } = $props();</script><h1>{title}</h1>';
    await writeFile(join(app, 'src/components/Child.svelte'), child);
    const published = await cli('publish', app);
    assert.equal(published.publish.state, 'succeeded');
    assert.ok(published.publish.changed_files.includes('src/components/Child.svelte'));
    const active = await pb.collection('_tk_projects').getOne(id);
    for (const key of ['content','design','data','settings','backend_code','assets']) assert.deepEqual(active[key], original[key]);
    assert.ok(active.source_bundle.files['src/components/Child.svelte']);
    assert.equal((await cli('remote-status', app)).in_sync, true);
    assert.equal((await cli('status', app)).last_publish.state, 'succeeded');
    phase = 'build failure';
    await writeFile(join(app, 'src/components/Child.svelte'), '<script>let broken = ;</script>');
    try { await cli('publish', app); assert.fail('invalid child should not publish'); }
    catch (error) { const result = JSON.parse(error.stdout); assert.equal(result.publish.stage, 'build'); }
    assert.equal((await pb.collection('_tk_projects').getOne(id)).published_html, active.published_html);
    await writeFile(join(app, 'src/components/Child.svelte'), child);
    phase = 'hosted child conflict';
    const changed = structuredClone(active.source_bundle);
    changed.files['src/components/Child.svelte'] = Buffer.from(child + '\n<p>Hosted edit</p>').toString('base64');
    await pb.collection('_tk_projects').update(id, { source_bundle: changed });
    await assert.rejects(cli('publish', app), error => /Hosted source changed/.test(JSON.parse(error.stdout).error));
    assert.equal((await cli('remote-status', app)).conflict, true);
    phase = 'fresh export and second publication';
    const second = join(temporary, 'second-copy');
    await cli('export', id, second);
    assert.deepEqual(JSON.parse(await readFile(join(second, 'seeds.json'))).bookmarks, []);
    await symlink(join(root, 'node_modules'), join(second, 'node_modules'), 'junction');
    await writeFile(join(second, 'src/components/Child.svelte'), child + '\n<p>Reconciled locally</p>');
    const secondPublish = await cli('publish', second);
    assert.deepEqual(secondPublish.publish.changed_files, ['src/components/Child.svelte']);
    assert.equal((await pb.collection('_tk_projects').getOne(id)).data.bookmarks.records.length, 4);
  } catch (error) {
    throw new Error(`Component CLI fixture failed during ${phase}: ${error.message}\n${logs.slice(-5000)}`, { cause: error });
  }
});
