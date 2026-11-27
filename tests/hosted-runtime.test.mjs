import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import PocketBase from 'pocketbase';
import { exportWorkspace } from '../scripts/companion/workspace.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const selected = socket.address().port; await new Promise(resolve => socket.close(resolve)); return selected; }
async function ready(fn) { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await delay(100); } throw new Error('Hosted fixture failed to start.'); }

test('push and headless publish preserve live records/uploads and detect stale source', { skip: !process.env.TINYKIT_TEST_HOSTED, timeout: 180000 }, async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-hosted-test-')));
  const dataDir = join(temporary, 'pb_data');
  const pbPort = await port(), webPort = await port();
  const server = `http://127.0.0.1:${webPort}`, pbURL = `http://127.0.0.1:${pbPort}`;
  const email = 'fixture@localhost.test', password = 'temporary-hosted-fixture-password';
  const binary = join(root, 'pocketbase/pocketbase');
  const flags = ['--automigrate=false', '--dir', dataDir, '--migrationsDir', join(root, 'pocketbase/pb_migrations'), '--hooksDir', join(root, 'pocketbase/pb_hooks')];
  let logs = '', phase = 'startup', pbProcess, webProcess, companionProcess;
  const track = child => { child.stdout?.on('data', value => { logs += value; }); child.stderr?.on('data', value => { logs += value; }); return child; };
  t.after(async () => {
    for (const child of [companionProcess, webProcess, pbProcess]) if (child?.pid && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(temporary, { recursive: true, force: true });
  });
  try {
    await exec(binary, ['superuser', 'upsert', email, password, ...flags]);
    pbProcess = track(spawn(binary, ['serve', '--http', `127.0.0.1:${pbPort}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const pb = new PocketBase(pbURL); pb.autoCancellation(false);
    await ready(async () => (await pb.health.check()).code === 200);
    await pb.collection('_superusers').authWithPassword(email, password);
    await pb.collection('users').create({ email, password, passwordConfirm: password });
    const user = new PocketBase(pbURL);
    const auth = await user.collection('users').authWithPassword(email, password);
    const id = '123456789abcdef';
    const initialSource = '<h1>Previously published</h1>';
    await pb.collection('_tk_projects').create({ id, name: 'Hosted test', kit: 'custom', frontend_code: initialSource, backend_code: '', content: [], design: [], data: { notes: { schema: [{ name: 'title', type: 'text' }], records: [{ id: 'live', title: 'Production record' }] } }, settings: { services: { secrets: { variables: [{ key: 'SECRET', value: 'keep-hosted-secret' }] } } } });
    const files = new FormData(); files.append('assets', new Blob(['private-upload']), 'private.txt'); files.append('published_html', new Blob(['<!DOCTYPE html><h1>Old working build</h1>'], { type: 'text/html' }), 'index.html');
    await pb.collection('_tk_projects').update(id, files);
    const original = await pb.collection('_tk_projects').getOne(id);
    const env = { ...process.env, TINYKIT_CONFIG_DIR: join(temporary, 'cli-auth'), POCKETBASE_URL: pbURL, POCKETBASE_ADMIN_EMAIL: email, POCKETBASE_ADMIN_PASSWORD: password, TINYKIT_SETUP_FILE: join(temporary, 'unused-setup'), TINYKIT_TOKEN: auth.token };
    delete env.TINYKIT_COMPANION_DIR; delete env.TINYKIT_COMPANION_ID; delete env.TINYKIT_COMPANION_ORIGIN;
    delete env.TINYKIT_TOKEN_FILE;
    webProcess = track(spawn(process.execPath, ['scripts/companion/server.mjs', String(webPort)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    const endpoint = `${server}/api/projects/${id}`;
    await ready(async () => (await fetch(`${endpoint}/hosted`, { headers })).ok);
    const exported = await (await fetch(`${endpoint}/export`, { headers })).json();
    assert.deepEqual(exported.data.notes.records, []);
    assert.deepEqual(exported.asset_files, []);
    const app = join(temporary, 'app'); await exportWorkspace(exported, app);
    await writeFile(join(app, 'App.svelte'), '<script>import content from "$content"; let count = $state(0);</script><h1>{content.title}</h1><button onclick={() => count++}>{count}</button>');
    await writeFile(join(app, 'content.json'), JSON.stringify([{ name: 'Title', type: 'text', value: 'Published from local files' }, { name: 'Logo', type: 'image', value: 'logo.svg' }]));
    await writeFile(join(app, 'schema.json'), JSON.stringify({ notes: [{ name: 'title', type: 'text' }, { name: 'done', type: 'boolean' }], additions: [{ name: 'title', type: 'text' }] }));
    await writeFile(join(app, 'seeds.json'), JSON.stringify({ notes: [{ id: 'local-only', title: 'Never upload this seed' }] }));
    await writeFile(join(app, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text y="10">source graphic</text></svg>');
    const cli = async (...args) => {
      const result = await exec(process.execPath, ['scripts/tinykit.mjs', ...args, app, '--json'], { cwd: root, env, maxBuffer: 3000000 });
      return JSON.parse(result.stdout);
    };
    await cli('login');
    delete env.TINYKIT_TOKEN;
    phase = 'initial push';
    const push = await cli('push');
    assert.equal(push.push.state, 'succeeded');
    const afterPush = await pb.collection('_tk_projects').getOne(id);
    assert.equal(afterPush.frontend_code, initialSource, 'push must not change the public source');
    assert.equal(afterPush.published_html, original.published_html);
    assert.deepEqual(afterPush.data, original.data);
    assert.deepEqual(afterPush.assets, original.assets);
    assert.deepEqual(afterPush.settings, original.settings);
    assert.doesNotMatch(JSON.stringify(afterPush.cli_draft), /Production record|local-only|private-upload|keep-hosted-secret/);
    // The hook's background domain lookup and the first public request must
    // await the same server sign-in rather than reporting a false 404.
    assert.equal((await fetch(`${server}/tinykit/preview/${id}`)).status, 200);

    // A live write between push and publish must not conflict or be overwritten.
    const live = await fetch(`${server}/_tk/data/${id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Arrived after push' }) });
    assert.equal(live.status, 201);
    const [, concurrentLive] = await Promise.all([
      cli('push'),
      fetch(`${server}/_tk/data/${id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Arrived during push' }) })
    ]);
    assert.equal(concurrentLive.status, 201);
    phase = 'initial publication';
    const published = await cli('publish');
    assert.equal(published.publish.state, 'succeeded');
    const active = await pb.collection('_tk_projects').getOne(id);
    assert.equal(active.data.notes.records.length, 3);
    assert.deepEqual(active.assets, original.assets);
    assert.deepEqual(active.settings, original.settings);
    assert.notEqual(active.published_html, original.published_html);
    assert.equal(active.cli_schema.notes.length, 2);
    const publicHTML = await (await fetch(published.public_url)).text();
    assert.match(publicHTML, /tinykit-definition/);
    assert.match(publicHTML, /data:text\/javascript;base64,/);
    const graphic = active.cli_publication.definition.assets['logo.svg'];
    assert.equal((await fetch(`${server}/_tk/source-assets/${id}/${graphic.digest}/logo.svg`)).status, 200);
    const newCollection = await fetch(`${server}/_tk/data/${id}/additions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'A new live collection' }) });
    assert.equal(newCollection.status, 201);
    assert.equal((await cli('remote-status')).published_revision, published.publish.revision);

    // Invalid builds retain the previous file; a retry publishes the saved draft.
    await writeFile(join(app, 'App.svelte'), '<script>let broken = ;</script>');
    await writeFile(join(app, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text y="10">updated graphic</text></svg>');
    phase = 'push invalid draft';
    await cli('push');
    const staged = (await pb.collection('_tk_projects').getOne(id)).cli_draft.definition.assets['logo.svg'];
    assert.equal((await fetch(`${server}/_tk/source-assets/${id}/${staged.digest}/logo.svg`)).status, 404);
    await assert.rejects(cli('publish'), /Build failed/);
    assert.equal((await pb.collection('_tk_projects').getOne(id)).published_html, active.published_html);
    await writeFile(join(app, 'App.svelte'), '<h1>Recovered publish</h1>');
    phase = 'push recovered draft';
    await cli('push');
    phase = 'publish recovered draft';
    const recovered = await cli('publish');
    assert.equal(recovered.publish.state, 'succeeded');
    assert.equal((await fetch(`${server}/_tk/source-assets/${id}/${graphic.digest}/logo.svg`)).status, 200, 'previously published assets remain available to open older app versions');
    assert.equal((await fetch(`${server}/_tk/source-assets/${id}/${staged.digest}/logo.svg`)).status, 200);
    const recoveredHTML = await (await fetch(recovered.public_url)).text();
    const repeat = await fetch(`${endpoint}/publish`, { method: 'POST', headers, body: JSON.stringify({ html: recoveredHTML, draft_revision: recovered.publish.revision, attempt_id: recovered.publish.attempt_id }) });
    assert.equal(repeat.status, 200);


    phase = 'companion publishing interface';
    const companionPort = await port();
    const companionURL = `http://127.0.0.1:${companionPort}`;
    companionProcess = track(spawn(process.execPath, ['scripts/tinykit.mjs', 'dev', app, '--port', String(companionPort), '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    await ready(async () => (await fetch(companionURL + '/companion/state')).ok);
    const ui = async payload => {
      const response = await fetch(companionURL + '/companion/hosted', { method: 'POST', headers: { Origin: companionURL, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const connected = await ui({ action: 'connect', server, project_id: id, email, password });
    assert.equal(connected.ok, true);
    assert.equal(connected.linked, true);
    assert.doesNotMatch(JSON.stringify(connected), /temporary-hosted-fixture-password|keep-hosted-secret|Production record|local-only/);
    await writeFile(join(app, 'App.svelte'), '<h1>Published through the companion</h1>');
    const staleReview = await ui({ action: 'push', review: connected.review });
    assert.equal(staleReview.ok, false);
    assert.match(staleReview.error, /changed since your review/);
    const reviewed = await ui({ action: 'review' });
    assert.equal(reviewed.changes.find(file => file.file === 'App.svelte').local, '<h1>Published through the companion</h1>');
    const fromUI = await ui({ action: 'push', publish: true, review: reviewed.review });
    assert.equal(fromUI.publish.state, 'succeeded');
    assert.equal((await pb.collection('_tk_projects').getOne(id)).data.notes.records.length, 3);
    await writeFile(join(app, 'App.svelte'), '<script>let broken = ;</script>');
    const invalidReview = await ui({ action: 'review' });
    const failedUIBuild = await ui({ action: 'push', publish: true, review: invalidReview.review });
    assert.equal(failedUIBuild.ok, false);
    assert.equal(failedUIBuild.push.state, 'succeeded');
    assert.equal(failedUIBuild.publish.state, 'failed');
    assert.equal((await pb.collection('_tk_projects').getOne(id)).cli_publication.revision, fromUI.publish.revision);
    await writeFile(join(app, 'App.svelte'), '<h1>Recovered companion source</h1>');

    // Hosted edits invalidate a local baseline, while destructive schemas fail.
    phase = 'conflicts and authorization';
    await pb.collection('_tk_projects').update(id, { frontend_code: '<h1>Edited in Studio</h1>' });
    await assert.rejects(cli('push'), /Hosted source or draft changed/);
    const conflictReview = await ui({ action: 'review' });
    assert.equal(conflictReview.conflict, true);
    assert.equal((await ui({ action: 'link', review: conflictReview.review })).ok, true);
    assert.equal((await ui({ action: 'review' })).conflict, false);
    const staleActivation = await fetch(`${endpoint}/publish`, { method: 'POST', headers, body: JSON.stringify({ html: recoveredHTML, draft_revision: recovered.publish.revision, attempt_id: 'stale-activation-123456789' }) });
    assert.equal(staleActivation.status, 409);
    await cli('link', '--server', server, '--project', id);
    await writeFile(join(app, 'schema.json'), JSON.stringify({ notes: [] }));
    await assert.rejects(cli('push'), /migration/);
    assert.equal((await pb.collection('_tk_projects').getOne(id)).data.notes.records.length, 3);
    assert.equal((await fetch(`${endpoint}/hosted`)).status, 401);
    // Even signed-in builders must satisfy the collection's current update rule.
    const collection = await pb.collections.getOne('_tk_projects');
    await pb.collections.update(collection.id, { updateRule: 'id = "unavailable"' });
    await assert.rejects(cli('push'), /Project update denied/);
    const denied = await fetch(`${endpoint}/publish`, { method: 'POST', headers, body: JSON.stringify({ html: '<!DOCTYPE html><meta name="tinykit-definition" content="' + recovered.publish.revision + '">', draft_revision: recovered.publish.revision, attempt_id: 'denied-attempt-123456789' }) });
    assert.equal(denied.status, 403);
  } catch (error) { error.message += '\nHosted test phase: ' + phase + '\nHosted fixture output:\n' + logs; throw error; }
});
