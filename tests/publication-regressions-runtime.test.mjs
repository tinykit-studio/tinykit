import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createServer, request } from 'node:http';
import PocketBase from 'pocketbase';
import { sourceHash } from '../scripts/static-project/source-tree.mjs';
import { createProject } from '../scripts/create-project.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
async function port() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function ready(fn) {
  for (let i = 0; i < 250; i++) {
    try { if (await fn()) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Publication fixture did not start');
}

test('publication is atomic across web workers and the editor can review a new target before creating it', { skip: !process.env.TINYKIT_TEST_PUBLICATION, timeout: 180000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'tinykit-publication-'));
  const children = []; let logs = '';
  const track = child => {
    children.push(child); child.stdout?.on('data', d => logs += d); child.stderr?.on('data', d => logs += d); return child;
  };
  t.after(async () => {
    for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.kill(); await done; clearTimeout(timer);
    }
    await rm(temporary, { recursive: true, force: true });
  });
  try {
    const pbPort = await port(), pbURL = `http://127.0.0.1:${pbPort}`;
    const email = 'publication@fixture.test', password = 'disposable-publication-password';
    const binary = join(root, 'pocketbase/pocketbase');
    const flags = ['--automigrate=false', '--dir', join(temporary, 'pb_data'), '--migrationsDir', join(root, 'pocketbase/pb_migrations'), '--hooksDir', join(root, 'pocketbase/pb_hooks')];
    await exec(binary, ['superuser', 'upsert', email, password, ...flags]);
    track(spawn(binary, ['serve', '--dev', '--http', `127.0.0.1:${pbPort}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const admin = new PocketBase(pbURL); admin.autoCancellation(false);
    await ready(async () => (await admin.health.check()).code === 200);
    await admin.collection('_superusers').authWithPassword(email, password);
    for (const address of [email, 'other@fixture.test']) await admin.collection('users').create({ email: address, password, passwordConfirm: password });
    const owner = new PocketBase(pbURL), other = new PocketBase(pbURL);
    const auth = await owner.collection('users').authWithPassword(email, password);
    await other.collection('users').authWithPassword('other@fixture.test', password);
    const env = { ...process.env, POCKETBASE_URL: pbURL, POCKETBASE_ADMIN_EMAIL: email, POCKETBASE_ADMIN_PASSWORD: password, TINYKIT_SETUP_FILE: join(temporary, 'unused'), TINYKIT_CONFIG_DIR: join(temporary, 'config') };
    for (const key of ['TINYKIT_COMPANION_DIR', 'TINYKIT_COMPANION_ID', 'TINYKIT_COMPANION_ORIGIN', 'TINYKIT_TOKEN', 'TINYKIT_TOKEN_FILE']) delete env[key];
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    let intercept;
    const relay = createServer(async (incoming, outgoing) => {
      if (await intercept?.(incoming, outgoing)) return;
      const upstream = request(new URL(incoming.url, pbURL), {
        method: incoming.method, headers: { ...incoming.headers, host: new URL(pbURL).host }
      }, response => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      });
      upstream.on('error', () => outgoing.writeHead(502).end());
      incoming.pipe(upstream);
    });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    t.after(() => { relay.close(); relay.closeAllConnections(); });
    const servers = [];
    for (let i = 0; i < 2; i++) {
      const webPort = await port(), server = `http://127.0.0.1:${webPort}`; servers.push(server);
      const workerEnv = i === 0 ? { ...env, POCKETBASE_URL: `http://127.0.0.1:${relay.address().port}` } : env;
      track(spawn(process.execPath, ['scripts/companion/server.mjs', String(webPort)], { cwd: root, env: workerEnv, stdio: ['ignore', 'pipe', 'pipe'] }));
      await ready(async () => (await fetch(server + '/api/projects', { headers })).ok);
    }
    const bundle = source => ({ format_version: 1, files: Object.fromEntries(Object.entries({ 'src/App.svelte': source, 'package.json': '{}', 'index.html': '<!doctype html>' }).map(([name, text]) => [name, Buffer.from(text).toString('base64')])) });
    for (const component of [false, true]) {
      const initial = '<h1>Initial résumé\r\n🙂</h1>';
      const project = await owner.collection('_tk_projects').create({ name: 'Concurrent publication', kit: 'custom', visibility: 'private', frontend_code: initial, source_bundle: component ? bundle(initial) : null, data: { notes: { schema: [], records: [{ id: 'keep', text: 'Keep me' }] } } });
      const expected = sourceHash(initial, project.source_bundle);
      const results = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
        const source = `<h1>Version ${i}\r\n日本語 🙂</h1>`;
        const response = await fetch(`${servers[i % 2]}/api/projects/${project.id}/build`, { method: 'POST', headers, body: JSON.stringify({ html: `<!DOCTYPE html>${source}`, frontend_code: source, expected_source_hash: expected, ...(component ? { source_bundle: bundle(source) } : {}) }) });
        return { status: response.status, body: await response.json(), source };
      }));
      assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
      assert.equal(results.filter(r => r.status === 409).length, 5, JSON.stringify(results));
      const winner = results.find(r => r.status === 200), saved = await admin.collection('_tk_projects').getOne(project.id);
      assert.equal(saved.frontend_code, winner.source);
      assert.equal(sourceHash(saved.frontend_code, saved.source_bundle), winner.body.source_hash);
      assert.deepEqual(saved.data, project.data);
      const html = await fetch(admin.files.getURL(saved, saved.published_html, { token: await admin.files.getToken() }));
      assert.equal(await html.text(), `<!DOCTYPE html>${winner.source}`);
      const endpoint = `${pbURL}/api/tinykit/projects/${project.id}/component-build`;
      const payload = { html: '<!DOCTYPE html>no', frontend_code: 'no', expected_source_hash: winner.body.source_hash };
      assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 401);
      assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${other.authStore.token}` }, body: JSON.stringify(payload) })).status, 403);
      const invalid = { ...bundle('no'), files: { ...bundle('no').files, '../outside': 'YQ==' } };
      assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...payload, source_bundle: invalid }) })).status, 400);
      t.diagnostic(`${component ? 'component' : 'single-file'}: one winner, five conflicts across two web workers`);
    }
    const legacy = '<h1>Original Studio source</h1>', next = '<h1>First CLI publication</h1>';
    const transition = await owner.collection('_tk_projects').create({ name: 'First CLI publication race', kit: 'custom', visibility: 'private', frontend_code: legacy });
    const buildPath = `/api/projects/${transition.id}/build`;
    const previewPath = `/tinykit/preview/${transition.id}`;
    const recordPath = `/api/collections/_tk_projects/records/${transition.id}`;
    const postBuild = (worker, body) => fetch(servers[worker] + buildPath, { method: 'POST', headers, body: JSON.stringify(body) });
    const studioBaseline = await postBuild(0, { html: legacy });
    assert.equal(studioBaseline.status, 200, await studioBaseline.text());
    let release, arrived;
    const held = new Promise(resolve => { release = resolve; });
    const studioWriteStarted = new Promise(resolve => { arrived = resolve; });
    intercept = async incoming => {
      const path = new URL(incoming.url, pbURL).pathname;
      if ((incoming.method === 'POST' && path === `/api/tinykit/projects/${transition.id}/component-build`) ||
          (incoming.method === 'PATCH' && path === recordPath)) {
        arrived();
        await held;
      }
      return false;
    };
    const studio = postBuild(0, { html: '<h1>Stale Studio artifact</h1>' });
    try {
      await Promise.race([studioWriteStarted, studio.then(response => assert.fail(`Studio finished before reaching PocketBase: ${response.status}`))]);
      const cli = await postBuild(1, { html: next, frontend_code: next, source_bundle: bundle(next), expected_source_hash: sourceHash(legacy) });
      assert.equal(cli.status, 200, await cli.text());
    } finally {
      release();
    }
    const staleStudio = await studio;
    assert.equal(staleStudio.status, 409, await staleStudio.text());
    const live = await fetch(servers[0] + previewPath, { headers });
    assert.equal(await live.text(), next);
    assert.equal((await fetch(servers[0] + previewPath, { redirect: 'manual' })).status, 303);
    // Fail only the guard's first lookup; a subsequent database read can succeed.
    let failedLookup = false;
    intercept = (incoming, outgoing) => {
      if (failedLookup || incoming.method !== 'GET' || new URL(incoming.url, pbURL).pathname !== recordPath) return false;
      failedLookup = true;
      outgoing.writeHead(503, { 'Content-Type': 'application/json' }).end('{"message":"Transient fixture error"}');
      return true;
    };
    const unavailable = await fetch(servers[0] + previewPath, { redirect: 'manual' });
    assert.equal(failedLookup, true);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await unavailable.text(), /First CLI publication/);
    intercept = undefined;
    const app = await createProject({ directory: join(temporary, 'fresh-app'), template: 'blank', visibility: 'private' });
    async function bridge(payload) {
      const child = track(spawn(process.execPath, ['scripts/companion/interface.mjs'], { cwd: root, env: { ...env, TINYKIT_COMPANION_DIR: app.directory }, stdio: ['pipe', 'pipe', 'pipe'] }));
      let output = ''; child.stdout.on('data', d => output += d); child.stdin.end(JSON.stringify(payload)); await once(child, 'exit'); return JSON.parse(output);
    }
    const connection = await bridge({ action: 'connect', server: servers[0], project_id: app.project_id, email, password });
    assert.equal(connection.ok, true, JSON.stringify(connection)); assert.equal(connection.new_target, true); assert.equal(connection.visibility, 'private');
    await assert.rejects(admin.collection('_tk_projects').getOne(app.project_id), e => e.status === 404);
    const sourcePath = join(app.directory, 'App.svelte'), source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source + '\n<p>New edit</p>');
    const stale = await bridge({ action: 'push', publish: true, review: connection.review });
    assert.equal(stale.ok, false); assert.match(stale.error, /changed since your review/);
    await assert.rejects(admin.collection('_tk_projects').getOne(app.project_id), e => e.status === 404);
    const reviewed = await bridge({ action: 'review' }); assert.equal(reviewed.new_target, true);
    const wrongTarget = await bridge({ action: 'push', publish: true, review: { ...reviewed.review, server: servers[1] } });
    assert.equal(wrongTarget.ok, false);
    await assert.rejects(admin.collection('_tk_projects').getOne(app.project_id), e => e.status === 404);
    const published = await bridge({ action: 'push', publish: true, review: reviewed.review });
    assert.equal(published.ok, true, JSON.stringify(published)); assert.equal(published.publish.state, 'succeeded');
    const created = await admin.collection('_tk_projects').getOne(app.project_id);
    assert.equal(created.visibility, 'private'); assert.equal(created.owner, auth.record.id); assert.deepEqual(created.data, {});
    const linked = await bridge({ action: 'review' }); assert.equal(linked.linked, true); assert.equal(linked.new_target, false);
    await admin.collection('_tk_projects').delete(app.project_id);
    const deleted = await bridge({ action: 'review' }); assert.equal(deleted.ok, false, 'A missing linked app must not be recreated automatically');
  } catch (error) { t.diagnostic(logs.slice(-8000)); throw error; }
});
