import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCreateArgs, createProject } from '../scripts/create-project.mjs';
import { checkWorkspace } from '../scripts/companion/check.mjs';
import { readStatus } from '../scripts/companion/status.mjs';
import { bootstrapHostedApp } from '../scripts/companion/bootstrap.mjs';
import { parseSkillArgs, installSkill } from '../scripts/install-skill.mjs';
import { hostedCommand } from '../scripts/companion/hosted.mjs';
import { createHash } from 'node:crypto';
import contract from '../pocketbase/pb_hooks/lib/definitions.cjs';
import { readWorkspace, writeAtomic } from '../scripts/companion/workspace.mjs';

const execute = promisify(execFile),
  studio = fileURLToPath(new URL('../', import.meta.url));
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'tinykit-create-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('create arguments default to private and reject missing values or ambiguous destinations', () => {
  assert.equal(parseCreateArgs(['crm']).visibility, 'private');
  assert.equal(parseCreateArgs(['crm', '--public']).visibility, 'public');
  for (const args of [
    [],
    ['a', 'b'],
    ['a', '--name'],
    ['a', '--template', 'unknown'],
    ['a', '--server', 'https://example.com']
  ])
    assert.throws(() => parseCreateArgs(args));
});
test('new CRM and blank apps are local-only, keep identity/private intent, and never overwrite a destination', async (t) => {
  const root = await temporary(t),
    previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('Creation must not contact a server');
  };
  t.after(() => (globalThis.fetch = previous));
  const created = [];
  for (const template of ['blank', 'crm', 'project-tracker']) {
    const directory = join(root, template);
    const result = await createProject(
      parseCreateArgs([directory, '--template', template, '--name', 'My app'])
    );
    created.push(result);
    assert.equal(result.local_only, true);
    assert.equal(result.hosting_required, false);
    const config = JSON.parse(await readFile(join(directory, 'tinykit.json'), 'utf8'));
    assert.equal(config.local_first, true);
    assert.equal(config.visibility, 'private');
    assert.equal(config.hosted, undefined);
    assert.equal(config.server, undefined);
    assert.match(config.project_id, /^[a-z0-9]{15}$/);
    await readFile(join(directory, 'TINYKIT.md'));
    assert.ok((await readFile(join(directory, 'AGENTS.md'), 'utf8')).includes('check . --json'));
    const before = await readFile(join(directory, 'App.svelte'), 'utf8');
    await assert.rejects(createProject(parseCreateArgs([directory])), (e) => e.code === 'EEXIST');
    assert.equal(await readFile(join(directory, 'App.svelte'), 'utf8'), before);
  }
  assert.equal(new Set(created.map((item) => item.project_id)).size, 3);
  const crm = JSON.parse(await readFile(join(root, 'crm/schema.json'), 'utf8'));
  assert.deepEqual(Object.keys(crm), ['contacts', 'companies', 'deals', 'notes', 'followups']);
});
test('check compiles without a dev process or hosting, reports stale results, and preserves seeds', async (t) => {
  const root = await temporary(t),
    directory = join(root, 'app');
  await createProject(parseCreateArgs([directory, '--template', 'crm']));
  const before = await readFile(join(directory, 'seeds.json'), 'utf8'),
    previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('Headless check must not contact hosting');
  };
  t.after(() => (globalThis.fetch = previous));
  assert.equal((await readStatus(directory)).compile.state, 'not_started');
  const checked = await checkWorkspace(directory);
  assert.equal(checked.ok, true);
  assert.equal(checked.build.state, 'success');
  assert.equal(checked.browser.state, 'not_checked');
  assert.equal(checked.tests.state, 'skipped');
  assert.equal((await readStatus(directory)).headless_check.state, 'success');
  await writeFile(join(directory, 'App.svelte'), '<script>\nlet broken = ;\n</script>');
  assert.equal((await readStatus(directory)).headless_check.state, 'stale');
  const failed = await checkWorkspace(directory);
  assert.equal(failed.ok, false);
  assert.equal(failed.diagnostics[0].file, 'App.svelte');
  assert.equal(failed.diagnostics[0].line, 2);
  assert.equal(await readFile(join(directory, 'seeds.json'), 'utf8'), before);
});
test('first-publication retries preserve the frozen intent and refuse another server or mismatched response', async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, '.tinykit'));
  const config = {
      local_first: true,
      project_id: '123456789abcdef',
      name: 'Original name',
      visibility: 'private'
    },
    server = 'https://tinykit.example',
    requests = [];
  await assert.rejects(
    bootstrapHostedApp(root, config, server, async (path, body) => {
      requests.push({ path, body });
      throw Error('response lost');
    }),
    (error) => error.creation.state === 'unknown'
  );
  assert.equal((await stat(join(root, '.tinykit/creation.json'))).mode & 0o777, 0o600);
  const state = JSON.parse(await readFile(join(root, '.tinykit/creation.json'), 'utf8'));
  const recovered = await bootstrapHostedApp(
    root,
    { ...config, name: 'Renamed locally' },
    server,
    async (path, body) => {
      assert.deepEqual(body, state.intent);
      return {
        protocol: 1,
        project_id: config.project_id,
        creation_id: body.creation_id,
        visibility: 'private',
        base_revision: 'a'.repeat(64),
        draft_revision: null,
        recovered: true
      };
    }
  );
  assert.equal(recovered.base_revision, 'a'.repeat(64));
  let called = false;
  await assert.rejects(
    bootstrapHostedApp(root, config, 'https://other.example', async () => {
      called = true;
    }),
    /another server/
  );
  assert.equal(called, false);
  await assert.rejects(
    bootstrapHostedApp(root, config, server, async () => ({
      protocol: 1,
      project_id: 'otheridentity00'
    })),
    /different creation identity/
  );
});
test('first publication requires an explicit destination without contacting a default host', async (t) => {
  const root = await temporary(t),
    directory = join(root, 'app');
  await createProject(parseCreateArgs([directory]));
  const previous = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    throw Error('Unexpected hosting call');
  };
  t.after(() => (globalThis.fetch = previous));
  await assert.rejects(
    hostedCommand('push', { directory, json: true, publish: true }),
    /first publication with --server/
  );
  assert.equal(called, false);
});
test('first-publication review binds visibility to its revision when configuration changes during the request', async (t) => {
  const root = await temporary(t), previousFetch = globalThis.fetch, previousToken = process.env.TINYKIT_TOKEN;
  process.env.TINYKIT_TOKEN = 'fixture-token';
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.TINYKIT_TOKEN;
    else process.env.TINYKIT_TOKEN = previousToken;
  });
  for (const visibility of ['public', 'private']) {
    const directory = join(root, visibility), original = visibility === 'public' ? 'private' : 'public';
    const app = await createProject({ directory, template: 'blank', visibility: original });
    const configPath = join(directory, 'tinykit.json');
    const setVisibility = async value => {
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      await writeAtomic(configPath, { ...config, visibility: value });
    };
    const server = 'https://tinykit.example', base = 'b'.repeat(64);
    let changed = false, created = null;
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/hosted')) {
        if (!changed) {
          // The request is in flight after hostedCommand's initial config read.
          await setVisibility(visibility);
          changed = true;
        }
        return created ? Response.json({ protocol: 1, base_revision: base, draft: null })
          : Response.json({ error: 'Not found' }, { status: 404 });
      }
      if (path.endsWith('/create')) {
        created = JSON.parse(options.body);
        return Response.json({ protocol: 1, project_id: app.project_id, creation_id: created.creation_id,
          visibility: created.visibility, base_revision: base, draft_revision: null });
      }
      if (path.endsWith('/draft')) {
        return Response.json({ draft: { revision: 'd'.repeat(64), base_revision: base } });
      }
      assert.ok(path.startsWith('/_pb/api/collections/_tk_projects/records/'));
      return Response.json({}, { status: 404 });
    };
    const reviewed = await hostedCommand('review', { directory, server });
    assert.equal(reviewed.visibility, visibility, 'the confirmation must display the revision’s visibility');
    assert.equal(reviewed.review.visibility, visibility);
    assert.equal(reviewed.review.local_revision, (await readWorkspace(directory)).revision);
    await assert.rejects(hostedCommand('push', { directory, server,
      review: { ...reviewed.review, visibility: original } }), /changed since your review/);
    assert.equal(created, null, 'mismatched approval must not create an app');
    await setVisibility(original);
    await assert.rejects(hostedCommand('push', { directory, server, review: reviewed.review }), /changed since your review/);
    assert.equal(created, null, 'edits after review must not create an app');
    await setVisibility(visibility);
    const result = await hostedCommand('push', { directory, server, review: reviewed.review });
    assert.equal(result.push.state, 'succeeded');
    assert.equal(created.visibility, reviewed.visibility, 'creation must honor the displayed visibility');
  }
});
test('the editor publish action activates saved draft A while newer local source B stays unpublished', async (t) => {
  const root=await temporary(t),directory=join(root,'app');
  const app=await createProject(parseCreateArgs([directory]));
  const localSource='<h1>New local B</h1>';await writeFile(join(directory,'App.svelte'),localSource);
  await mkdir(join(directory,'.tinykit'));
  const definition={name:'Saved draft',frontend_code:'<h1>Saved A</h1>',backend_code:'',custom_instructions:'',content:[],design:[],schema:{},assets:{}};
  const revision=createHash('sha256').update(contract.canonical(definition)).digest('hex');
  const base='b'.repeat(64),server='https://tinykit.example';
  await writeAtomic(join(directory,'.tinykit/remote.json'),{server,project_id:app.project_id,base_revision:base,draft_revision:revision});
  const workspace=await readWorkspace(directory),calls=[],previousFetch=globalThis.fetch,previousToken=process.env.TINYKIT_TOKEN;
  process.env.TINYKIT_TOKEN='fixture-token';
  t.after(()=>{globalThis.fetch=previousFetch;if(previousToken===undefined)delete process.env.TINYKIT_TOKEN;else process.env.TINYKIT_TOKEN=previousToken});
  globalThis.fetch=async(url,options)=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path.endsWith('/hosted'))return Response.json({protocol:1,base_revision:base,definition,draft:{revision,base_revision:base,definition},publication:null,public_path:`/tinykit/preview/${app.project_id}`});
    assert.ok(path.endsWith('/publish'),'must not push a newer local draft');
    const body=JSON.parse(options.body);assert.equal(body.draft_revision,revision);
    const javascript=Buffer.from(body.html.match(/data:text\/javascript;base64,([^"<>]+)/)[1],'base64').toString();assert.ok(javascript.includes('Saved A'));assert.ok(!javascript.includes('New local B'));
    return Response.json({publication:{revision,base_revision:'c'.repeat(64),attempt_id:body.attempt_id}});
  };
  const result=await hostedCommand('publish',{directory,review:{local_revision:workspace.revision,base_revision:base,draft_revision:revision}});
  assert.equal(result.publish.state,'succeeded');assert.ok(!calls.some(path=>path.endsWith('/draft')));assert.equal(await readFile(join(directory,'App.svelte'),'utf8'),localSource);
});
test('skill installation supplies a working CLI launcher and preserves unmanaged skills and symlinks', async (t) => {
  const root = await temporary(t),
    parent = join(root, 'skills');
  const result = await installSkill({ directory: parent });
  const helper = join(result.directory, 'scripts/tinykit.mjs');
  const app = join(root, 'from-skill');
  const created = JSON.parse(
    (await execute(process.execPath, [helper, 'create', app, '--json'], { cwd: root })).stdout
  );
  assert.equal(created.local_only, true);
  await installSkill({ directory: parent });
  const unmanaged = join(root, 'unmanaged');
  await mkdir(join(unmanaged, 'tinykit'), { recursive: true });
  await writeFile(join(unmanaged, 'tinykit/SKILL.md'), 'keep');
  await assert.rejects(installSkill({ directory: unmanaged }), /not installed by Tinykit/);
  assert.equal(await readFile(join(unmanaged, 'tinykit/SKILL.md'), 'utf8'), 'keep');
  const linked = join(root, 'linked');
  await symlink(parent, linked);
  await assert.rejects(installSkill({ directory: linked }), /symbolic links/);
  const outside = join(root, 'outside.md');
  await writeFile(outside, 'keep outside');
  const reference = join(result.directory, 'references/app-format.md');
  await rm(reference);
  await symlink(outside, reference);
  await assert.rejects(installSkill({ directory: parent }), /contains a symbolic link/);
  assert.equal(await readFile(outside, 'utf8'), 'keep outside');
  assert.equal(parseSkillArgs(['install', '--directory', parent, '--json']).json, true);
});
test('CLI check emits parseable JSON and returns failure for invalid source', async (t) => {
  const root = await temporary(t),
    directory = join(root, 'app');
  await createProject(parseCreateArgs([directory]));
  await writeFile(join(directory, 'App.svelte'), '<script>let broken = ;</script>');
  await assert.rejects(
    execute(process.execPath, ['scripts/tinykit.mjs', 'check', directory, '--json'], {
      cwd: studio
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      return error.code === 1 && result.ok === false && result.build.state === 'error';
    }
  );
});
