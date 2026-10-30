import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import net from 'node:net';
import PocketBase from 'pocketbase';
import definitions from '../pocketbase/pb_hooks/lib/definitions.cjs';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextId = () => randomBytes(8).toString('hex').slice(0, 15);
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const selected = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return selected;
}

test('first publication creates only its own empty target and recovers retries without adopting newer source', { skip: !process.env.TINYKIT_TEST_CREATE_SERVER, timeout: 60000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'tinykit-create-server-'));
  const selectedPort = await port(), origin = `http://127.0.0.1:${selectedPort}`;
  const email = 'create-owner@fixture.test', password = 'create-fixture-password';
  const binary = join(root, 'pocketbase/pocketbase');
  const flags = ['--automigrate=false', '--dir', join(temporary, 'data'), '--migrationsDir', join(root, 'pocketbase/pb_migrations'), '--hooksDir', join(root, 'pocketbase/pb_hooks')];
  let processHandle, logs = '';
  t.after(async () => {
    if (processHandle?.exitCode === null && processHandle.signalCode === null) {
      const exited = once(processHandle, 'exit'), timer = setTimeout(() => processHandle.kill('SIGKILL'), 2000);
      processHandle.kill(); await exited; clearTimeout(timer);
    }
    await rm(temporary, { recursive: true, force: true });
  });
  try {
    await exec(binary, ['superuser', 'upsert', email, password, ...flags]);
    processHandle = spawn(binary, ['serve', '--http', `127.0.0.1:${selectedPort}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', value => { logs += value; });
    const admin = new PocketBase(origin); admin.autoCancellation(false);
    let ready = false;
    for (let i = 0; i < 150; i++) { try { await admin.health.check(); ready = true; break; } catch { await delay(100); } }
    assert.ok(ready, 'disposable PocketBase must start');
    await admin.collection('_superusers').authWithPassword(email, password);
    for (const address of [email, 'create-other@fixture.test']) await admin.collection('users').create({ email: address, password, passwordConfirm: password });
    const owner = new PocketBase(origin), other = new PocketBase(origin);
    const ownerAuth = await owner.collection('users').authWithPassword(email, password);
    await other.collection('users').authWithPassword('create-other@fixture.test', password);
    const request = async (id, body, token = owner.authStore.token) => {
      const response = await fetch(`${origin}/api/tinykit/projects/${id}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    const intent = (name = 'Private CRM', visibility = 'private') => ({ creation_id: randomUUID(), name, visibility });
    const all = () => admin.collection('_tk_projects').getFullList();
    let createdId, createdIntent, originalBase;

    await t.test('requires a regular account and validates the complete intent before inserting anything', async () => {
      const initial = await all();
      assert.equal((await request(nextId(), intent(), '')).status, 401);
      assert.ok([401, 403].includes((await request(nextId(), intent(), admin.authStore.token)).status));
      for (const body of [intent(''), intent(' '.repeat(5)), intent('x'.repeat(101)), intent('Bad\nname'), intent('CRM', 'shared'), { ...intent(), creation_id: 'not-a-uuid' }, { ...intent(), data: { contacts: [{ name: 'Must not upload' }] } }]) assert.equal((await request(nextId(), body)).status, 400);
      assert.equal((await request('invalid', intent())).status, 400);
      assert.equal((await all()).length, initial.length);
    });

    await t.test('creates the exact empty private target and returns the original source baseline', async () => {
      createdId = nextId(); createdIntent = intent();
      const created = await request(createdId, createdIntent);
      assert.equal(created.status, 201);
      assert.deepEqual(Object.keys(created.value).sort(), ['protocol', 'project_id', 'creation_id', 'visibility', 'base_revision', 'draft_revision', 'recovered'].sort());
      assert.equal(created.value.protocol, 1); assert.equal(created.value.project_id, createdId); assert.equal(created.value.creation_id, createdIntent.creation_id);
      assert.equal(created.value.visibility, 'private'); assert.equal(created.value.draft_revision, null); assert.equal(created.value.recovered, false);
      const record = await admin.collection('_tk_projects').getOne(createdId);
      assert.equal(record.owner, ownerAuth.record.id); assert.equal(record.visibility, 'private'); assert.equal(record.kit, 'custom'); assert.equal(record.domain, '');
      for (const field of ['frontend_code', 'backend_code', 'published_html']) assert.equal(record[field], '');
      for (const field of ['content', 'design', 'assets']) assert.deepEqual(record[field], []);
      assert.deepEqual(record.data, {}); assert.deepEqual(record.settings, {});
      originalBase = createHash('sha256').update(definitions.canonical(definitions.sourceState(record))).digest('hex');
      assert.equal(created.value.base_revision, originalBase); assert.equal(record.cli_creation.base_revision, originalBase); assert.equal(record.cli_creation.creation_id, createdIntent.creation_id);
      assert.match(record.cli_creation.request_fingerprint, /^[a-f0-9]{64}$/);
      await assert.rejects(other.collection('_tk_projects').getOne(createdId));
    });

    await t.test('same creation recovers without another insertion; changed intent or another account cannot adopt it', async () => {
      const retried = await request(createdId, createdIntent);
      assert.equal(retried.status, 200); assert.equal(retried.value.recovered, true); assert.equal(retried.value.base_revision, originalBase);
      assert.equal((await all()).filter(record => record.id === createdId).length, 1);
      for (const body of [{ ...createdIntent, creation_id: randomUUID() }, { ...createdIntent, name: 'A different app' }, { ...createdIntent, visibility: 'public' }]) assert.equal((await request(createdId, body)).status, 409);
      assert.equal((await request(createdId, createdIntent, other.authStore.token)).status, 409);
    });

    await t.test('recovery keeps the creation baseline after hosted source and runtime records change', async () => {
      const changed = await owner.collection('_tk_projects').update(createdId, { name: 'Edited on the host', frontend_code: '<h1>New hosted source</h1>', content: [{ name: 'Title', type: 'text', value: 'Changed title' }], data: { contacts: { schema: [{ name: 'name', type: 'text' }], records: [{ id: 'live-record', name: 'Keep this live contact' }] } } });
      const nextBase = createHash('sha256').update(definitions.canonical(definitions.sourceState(changed))).digest('hex');
      assert.notEqual(nextBase, originalBase);
      const recovered = await request(createdId, createdIntent);
      assert.equal(recovered.status, 200); assert.equal(recovered.value.base_revision, originalBase); assert.equal(recovered.value.draft_revision, null);
      const after = await owner.collection('_tk_projects').getOne(createdId);
      for (const key of ['frontend_code', 'name', 'data', 'content', 'cli_creation', 'updated']) assert.deepEqual(after[key], changed[key]);
    });

    await t.test('an unrelated readable public record and forged raw markers cannot become a target', async () => {
      const publicRecord = await owner.collection('_tk_projects').create({ name: 'Existing public app', kit: 'custom', visibility: 'public', data: { notes: { schema: [], records: [{ id: 'keep' }] } } });
      assert.equal((await other.collection('_tk_projects').getOne(publicRecord.id)).id, publicRecord.id);
      assert.equal((await request(publicRecord.id, intent('Existing public app', 'public'))).status, 409);
      assert.equal((await request(publicRecord.id, intent('Existing public app', 'public'), other.authStore.token)).status, 409);
      const marker = { creation_id: randomUUID(), request_fingerprint: 'a'.repeat(64), base_revision: 'b'.repeat(64) };
      await assert.rejects(owner.collection('_tk_projects').create({ name: 'Forged new app', kit: 'custom', cli_creation: marker }), error => error.status === 403);
      for (const actor of [owner, other]) await assert.rejects(actor.collection('_tk_projects').update(publicRecord.id, { cli_creation: marker }), error => error.status === 403);
      await assert.rejects(owner.collection('_tk_projects').update(createdId, { cli_creation: null }), error => error.status === 403);
      assert.deepEqual((await owner.collection('_tk_projects').getOne(publicRecord.id)).data, publicRecord.data);
    });

    await t.test('concurrent retries create one target, with explicit public access when requested', async () => {
      const id = nextId(), body = intent('Public starter', 'public');
      const results = await Promise.all([request(id, body), request(id, body)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
      assert.equal(results[0].value.base_revision, results[1].value.base_revision);
      const record = await owner.collection('_tk_projects').getOne(id);
      assert.equal(record.visibility, 'public'); assert.equal(record.owner, ownerAuth.record.id); assert.deepEqual(record.data, {});
    });

    await t.test('custom create rules are evaluated against the inserted fields and denial rolls the transaction back', async () => {
      const original = await admin.collections.getOne('_tk_projects');
      try {
        const rule = "@request.auth.id != '' && owner = @request.auth.id && name = 'Allowed app'";
        await admin.collections.update(original.id, { createRule: rule });
        const deniedId = nextId();
        assert.equal((await request(deniedId, intent('Denied app'))).status, 403);
        await assert.rejects(admin.collection('_tk_projects').getOne(deniedId), error => error.status === 404);
        assert.equal((await request(nextId(), intent('Allowed app'))).status, 201);
        await admin.collections.update(original.id, { createRule: "@request.body.name = 'Body rule'" });
        assert.equal((await request(nextId(), intent('Body rule'))).status, 201);
        assert.equal((await request(nextId(), intent('Denied body rule'))).status, 403);
        await admin.collections.update(original.id, { createRule: null });
        const lockedId = nextId(); assert.equal((await request(lockedId, intent())).status, 403);
        await assert.rejects(admin.collection('_tk_projects').getOne(lockedId), error => error.status === 404);
      } finally { await admin.collections.update(original.id, { createRule: original.createRule }); }
    });

    await t.test('recovery refuses changed privacy or newly denied view access without changing the target', async () => {
      const id = nextId(), body = intent(); await request(id, body);
      await owner.collection('_tk_projects').update(id, { visibility: 'public' });
      assert.equal((await request(id, body)).status, 409);
      await owner.collection('_tk_projects').update(id, { visibility: 'private' });
      const original = await admin.collections.getOne('_tk_projects');
      try { await admin.collections.update(original.id, { viewRule: null }); assert.equal((await request(id, body)).status, 403); }
      finally { await admin.collections.update(original.id, { viewRule: original.viewRule }); }
      assert.equal((await owner.collection('_tk_projects').getOne(id)).visibility, 'private');
    });
  } catch (error) { error.message += '\n' + JSON.stringify(error.response) + '\n' + logs.slice(-8000); throw error; }
});
