import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import PocketBase from 'pocketbase';

const execute = promisify(execFile),
  root = fileURLToPath(new URL('../', import.meta.url)),
  delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const value = s.address().port;
  await new Promise((r) => s.close(r));
  return value;
}
async function ready(fn) {
  for (let i = 0; i < 300; i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await delay(100);
  }
  throw Error('Agent-first fixture did not become ready');
}
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'exit'),
      timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.kill();
    await done;
    clearTimeout(timer);
  }
}

test(
  'a new local CRM previews and restarts without hosting, then publishes privately and preserves hosted records on a source/schema update',
  { skip: !process.env.TINYKIT_TEST_AGENT_FIRST, timeout: 180000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'tinykit-agent-first-')),
      app = join(temporary, 'crm');
    const env = { ...process.env, TINYKIT_CONFIG_DIR: join(temporary, 'auth') };
    for (const key of [
      'TINYKIT_TOKEN',
      'TINYKIT_TOKEN_FILE',
      'TINYKIT_COMPANION_DIR',
      'TINYKIT_COMPANION_ID',
      'TINYKIT_COMPANION_ORIGIN'
    ])
      delete env[key];
    let logs = '',
      children = [];
    const track = (child) => {
      children.push(child);
      child.stdout?.on('data', (v) => (logs += v));
      child.stderr?.on('data', (v) => (logs += v));
      return child;
    };
    t.after(async () => {
      for (const child of children.reverse()) await stop(child);
      await rm(temporary, { recursive: true, force: true });
    });
    const cli = async (command, ...args) =>
      JSON.parse(
        (
          await execute(process.execPath, ['scripts/tinykit.mjs', command, ...args, '--json'], {
            cwd: root,
            env,
            maxBuffer: 3000000
          })
        ).stdout
      );
    try {
      const created = await cli('create', app, '--template', 'crm', '--name', 'Agent-first CRM');
      assert.equal(created.local_only, true);
      assert.equal(created.visibility, 'private');
      assert.equal((await cli('check', app)).build.state, 'success');
      assert.equal((await cli('status', app)).running, false);
      async function startLocal() {
        const child = track(
          spawn(process.execPath, ['scripts/tinykit.mjs', 'dev', app, '--no-open'], {
            cwd: root,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        );
        const dev = await ready(async () => {
          const state = JSON.parse(await readFile(join(app, '.tinykit/dev-server.json'), 'utf8'));
          if (state.pid !== child.pid) return;
          return (await fetch(state.url + '/state')).ok ? state : null;
        });
        assert.match(dev.preview_url, /\/companion\?view=app$/);
        return { child, dev, origin: new URL(dev.url).origin };
      }
      let local = await startLocal();
      const localEndpoint = () => `${local.origin}/_tk/data/${created.project_id}/contacts`;
      let response = await fetch(localEndpoint(), {
        method: 'POST',
        headers: { Origin: local.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Local-only contact', company_id: '' })
      });
      assert.equal(response.status, 201);
      const localContact = await response.json();
      await stop(local.child);
      local = await startLocal();
      assert.ok(
        (await (await fetch(localEndpoint())).json()).items.some(
          (row) => row.id === localContact.id
        )
      );
      const pbPort = await port(),
        webPort = await port(),
        server = `http://127.0.0.1:${webPort}`,
        pbURL = `http://127.0.0.1:${pbPort}`;
      const email = 'owner@agent-first.test',
        password = 'agent-first-fixture-password',
        binary = join(root, 'pocketbase/pocketbase');
      const flags = [
        '--automigrate=false',
        '--dir',
        join(temporary, 'hosted-data'),
        '--migrationsDir',
        join(root, 'pocketbase/pb_migrations'),
        '--hooksDir',
        join(root, 'pocketbase/pb_hooks')
      ];
      await execute(binary, ['superuser', 'upsert', email, password, ...flags]);
      track(
        spawn(binary, ['serve', '--http', `127.0.0.1:${pbPort}`, ...flags], {
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
      const pb = new PocketBase(pbURL);
      pb.autoCancellation(false);
      await ready(async () => (await pb.health.check()).code === 200);
      await pb.collection('_superusers').authWithPassword(email, password);
      await pb.collection('users').create({ email, password, passwordConfirm: password });
      const owner = new PocketBase(pbURL),
        auth = await owner.collection('users').authWithPassword(email, password);
      track(
        spawn(process.execPath, ['scripts/companion/server.mjs', String(webPort)], {
          cwd: root,
          env: {
            ...env,
            POCKETBASE_URL: pbURL,
            POCKETBASE_ADMIN_EMAIL: email,
            POCKETBASE_ADMIN_PASSWORD: password,
            TINYKIT_SETUP_FILE: join(temporary, 'unused-setup')
          },
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
      await ready(
        async () =>
          (
            await fetch(server + '/api/projects', {
              headers: { Authorization: `Bearer ${auth.token}` }
            })
          ).ok
      );
      env.TINYKIT_TOKEN = auth.token;
      await cli('login', app, '--server', server);
      delete env.TINYKIT_TOKEN;
      const published = await cli('publish', app, '--server', server);
      assert.equal(published.publish.state, 'succeeded');
      const hosted = await owner.collection('_tk_projects').getOne(created.project_id);
      assert.equal(hosted.visibility, 'private');
      assert.equal(hosted.owner, auth.record.id);
      assert.deepEqual(hosted.data, {});
      assert.ok(hosted.cli_creation.creation_id);
      const target = `${server}/_tk/data/${created.project_id}/contacts`;
      const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(target)).status, 401);
      assert.equal((await fetch(published.public_url, { redirect: 'manual' })).status, 303);
      response = await fetch(target, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Hosted contact', email: 'fictional@example.test' })
      });
      assert.equal(response.status, 201);
      const hostedContact = await response.json();
      const before = (await owner.collection('_tk_projects').getOne(created.project_id)).data;
      const schema = JSON.parse(await readFile(join(app, 'schema.json'), 'utf8'));
      schema.contacts.push({ name: 'preferred_contact_method', type: 'text' });
      await writeFile(join(app, 'schema.json'), JSON.stringify(schema));
      const fields = JSON.parse(await readFile(join(app, 'content.json'), 'utf8'));
      fields[0].value = 'Updated CRM';
      await writeFile(join(app, 'content.json'), JSON.stringify(fields));
      const checked = await cli('check', app);
      assert.equal(checked.ok, true);
      const republished = await cli('publish', app);
      assert.equal(republished.publish.state, 'succeeded');
      const after = await owner.collection('_tk_projects').getOne(created.project_id);
      assert.deepEqual(after.data, before);
      assert.equal(after.visibility, 'private');
      assert.ok(
        after.cli_schema.contacts.some((field) => field.name === 'preferred_contact_method')
      );
      const live = (await (await fetch(target, { headers })).json()).items;
      assert.ok(live.some((row) => row.id === hostedContact.id));
      assert.ok(!live.some((row) => row.id === localContact.id));
      assert.ok(
        (await (await fetch(localEndpoint())).json()).items.some(
          (row) => row.id === localContact.id
        )
      );
    } catch (error) {
      error.message += '\n' + logs.slice(-10000);
      throw error;
    }
  }
);
