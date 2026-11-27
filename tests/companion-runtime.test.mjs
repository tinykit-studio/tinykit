import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import { exportWorkspace } from '../scripts/companion/workspace.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(200);
  }
  throw new Error(`Timed out: ${label}`);
}

test('real companion imports edits, preserves data, reports errors, isolates access, and stops cleanly', { skip: !process.env.TINYKIT_TEST_RUNTIME, timeout: 90000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'tinykit-runtime-test-'));
  const app = join(temporary, 'app');
  const source = '<script>import content from "$content";</script><h1>{content.title}</h1>';
  const project = { name: 'Runtime test', frontend_code: source, content: [{ id: 'title', name: 'Title', type: 'text', value: 'Hello' }], data: { notes: { schema: [{ name: 'title', type: 'text' }], records: [] } } };
  await exportWorkspace(project, app);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let logs = '';
  function launch() {
    const child = spawn(process.execPath, ['scripts/tinykit.mjs', 'dev', app, '--port', String(port), '--no-open'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    return child;
  }
  let child = launch();
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(temporary, { recursive: true, force: true });
  });
  const state = async () => {
    const response = await fetch(base + '/companion/state');
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    await until(async () => (await state()).project.name === 'Runtime test', 'startup');
    assert.equal((await fetch(base + '/companion')).status, 200);
    const id = (await state()).project.id;
    const capability = (await state()).preview_capability;
    const hostedURL = base + '/companion/hosted';
    const operation = (origin, payload) => fetch(hostedURL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(payload) });
    assert.equal((await operation(null, { action: 'connection' })).status, 403);
    assert.equal((await operation('null', { action: 'connection' })).status, 403);
    assert.equal((await operation(base, { action: 'not-supported' })).status, 400);
    const connection = await (await operation(base, { action: 'connection' })).json();
    assert.equal(connection.ok, true);
    assert.equal(connection.project_id, id);
    assert.equal((await fetch(hostedURL + '?_preview=' + capability, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: JSON.stringify({ action: 'connection' }) })).status, 403);
    const previewURL = `${base}/_tk/data/${id}/notes?_preview=${capability}`;
    const opaqueRead = await fetch(previewURL, { headers: { Origin: 'null' } });
    assert.equal(opaqueRead.status, 200);
    assert.equal(opaqueRead.headers.get('Access-Control-Allow-Origin'), 'null');
    assert.equal((await fetch(previewURL.replace(capability, 'wrong'), { headers: { Origin: 'null' } })).status, 403);
    const preflight = await fetch(previewURL, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(preflight.status, 204);

    const dataURL = `${base}/_tk/data/${id}/notes`;
    const created = await fetch(dataURL, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ title: 'Keep local data' }) });
    assert.equal(created.status, 201);

    // Atomic saves are how most external editors update files.
    await writeFile(join(app, 'App.svelte.tmp'), '<h1>Edited by agent</h1>');
    await rename(join(app, 'App.svelte.tmp'), join(app, 'App.svelte'));
    await until(async () => (await state()).project.frontend_code === '<h1>Edited by agent</h1>', 'source synchronization');
    assert.equal((await (await fetch(dataURL)).json()).items[0].title, 'Keep local data');

    await writeFile(join(app, 'App.svelte'), '<h1>{#if }</h1>');
    await until(async () => (await state()).status.diagnostic?.line === 1, 'compile error');
    assert.match(await readFile(join(app, '.tinykit/status.json'), 'utf8'), /App.svelte/);
    await writeFile(join(app, 'App.svelte'), source);
    await until(async () => { const result = await state(); return !result.status.diagnostic && result.project.frontend_code === source; }, 'compile recovery');

    await writeFile(join(app, 'content.json'), '{');
    await until(async () => (await state()).status.import_error?.includes('content.json'), 'JSON error');
    assert.equal((await state()).project.content[0].value, 'Hello');
    await writeFile(join(app, 'content.json'), JSON.stringify([{ ...project.content[0], value: 'Updated content' }]));
    await until(async () => { const result = await state(); return !result.status.import_error && result.project.content[0].value === 'Updated content'; }, 'JSON recovery');

    const priorAssets = (await state()).status.asset_revision;
    await writeFile(join(app, 'assets/test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await until(async () => (await state()).status.asset_revision !== priorAssets, 'asset import');
    assert.equal((await fetch(`${base}/_tk/assets/${id}/test.svg`)).headers.get('content-type'), 'image/svg+xml');
    assert.equal((await fetch(base + '/companion/state', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    // Node fetch replaces Host; use an actual HTTP request to exercise host validation.
    const wrongHostStatus = await new Promise((resolve, reject) => {
      http.get(base + '/companion/state', { headers: { Host: 'unrelated.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal((await fetch(base + '/_pb/api/collections/_tk_projects/records')).status, 404);
    assert.equal((await fetch(base + '/api/projects')).status, 404);
    assert.equal((await fetch(base + '/_tk/data/anotherproject/notes')).status, 404);

    const currentStatus = (await state()).status;
    const currentRevision = `${currentStatus.session_id}:${currentStatus.source_revision}`;
    const report = (revision, attempt, state, error) => fetch(base + '/companion/state', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ revision, attempt, state, error }) });
    assert.equal(currentStatus.compile.state, 'pending', 'headless syntax checks must not claim browser compilation succeeded');
    assert.equal((await report(currentRevision, 'old', 'pending')).status, 200);
    assert.equal((await report(currentRevision, 'new', 'pending')).status, 200);
    assert.equal((await report(currentRevision, 'old', 'success')).status, 409);
    assert.equal((await report(currentRevision, 'new', 'error', 'Missing module')).status, 200);
    assert.equal((await state()).status.compile.error, 'Missing module');
    assert.equal((await report(currentRevision, 'new', 'success')).status, 200);
    assert.equal((await state()).status.compile.state, 'success');
    assert.equal((await report('older:revision', 'old', 'pending')).status, 409);

    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code] = await exited;
    assert.equal(code, 0);
    await assert.rejects(access(join(app, '.tinykit/dev.lock')));

    child = launch();
    await until(async () => (await state()).status.session_id !== currentStatus.session_id, 'restart');
    assert.equal((await state()).status.compile.state, 'pending', 'a prior process compilation is not current after restart');
    assert.equal((await (await fetch(dataURL)).json()).items[0].title, 'Keep local data');
    const restartedExit = once(child, 'exit');
    child.kill('SIGTERM');
    assert.equal((await restartedExit)[0], 0);
    await assert.rejects(access(join(app, '.tinykit/dev.lock')));
  } catch (error) {
    error.message += '\nCompanion output:\n' + logs;
    throw error;
  }
});
