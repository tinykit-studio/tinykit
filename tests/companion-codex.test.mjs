import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, realpath, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { openInCodex, codexTaskStatus, stopCodex, focusCodex, codexEnvironment, threadURL, findCodexBinary, verifyCodexSignIn } from '../scripts/companion/codex.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-codex-')));
  await writeFile(join(root, 'tinykit.json'), JSON.stringify({ format_version: 1 }));
  const binary = join(root, 'fake-codex.mjs');
  await writeFile(binary, `#!${process.execPath}\nimport {appendFileSync,writeFileSync} from 'node:fs';
if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
appendFileSync('calls.jsonl',JSON.stringify({args:process.argv.slice(2),prompt,keys:Object.keys(process.env)})+'\\n');
const emit=value=>console.log(JSON.stringify(value));
emit({type:'thread.started',thread_id:'11111111-1111-4111-8111-111111111111'});
if(prompt.includes('[descendant]')){const {spawn}=await import('node:child_process');spawn(process.execPath,['-e',\`process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync('unwanted-write.txt','still running'),1500);setInterval(()=>{},1000);\`],{stdio:'ignore'});}
if(prompt.includes('[wait]'))await new Promise(resolve=>setTimeout(resolve,30000));
if(prompt.includes('[fail]')){emit({type:'turn.failed',error:{message:'failure'}});process.exit(1);}
if(prompt.includes('[incomplete]'))process.exit(0);
writeFileSync('customized.txt','the exact request was submitted');
emit({type:'item.completed',item:{type:'agent_message',text:'Your tracker is customized.'}});
emit({type:'turn.completed'});
`, { mode: 0o700 });
  const getStatus = async () => ({ available: true, binary });
  t.after(async () => {
    const job = await codexTaskStatus(root).catch(() => null);
    if (job?.active) { await stopCodex(root); await wait(root, value => !value?.active); }
    await rm(root, { recursive: true, force: true });
  });
  return { root, binary, options: { getStatus, waitMs: 500 } };
}
async function wait(root, predicate) {
  for (let i = 0; i < 100; i++) { const job = await codexTaskStatus(root); if (predicate(job)) return job; await delay(100); }
  throw new Error('Codex task did not reach the expected state.');
}

test('discovery skips an executable npm wrapper whose native binary is missing', async t => {
  const f = await fixture(t), broken = join(f.root, 'broken-codex.mjs');
  await writeFile(broken, `#!${process.execPath}\nconsole.error('Error: spawn native-codex ENOENT');process.exit(1);\n`, {mode:0o700});
  await writeFile(f.binary, `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('codex-cli 0.164.0');else console.error('Logged in using ChatGPT');\n`, {mode:0o700});
  assert.equal(await findCodexBinary([broken, broken, f.binary]), f.binary);
  assert.equal(await findCodexBinary([broken]), null);
  await verifyCodexSignIn(f.binary, f.root);
  assert.equal(await codexTaskStatus(f.root), null, 'discovery and authentication must not submit a task');
});

test('authentication distinguishes signed-out, broken launcher, and credential-store failures without exposing diagnostics', async t => {
  const f=await fixture(t);
  for (const [diagnostic, message] of [
    ['Not logged in', /Sign in to Codex with ChatGPT/],
    ['Error: spawn native-codex ENOENT', /launcher could not start/],
    ['Permission denied reading keychain private-secret', /could not access its saved sign-in/],
    ['Invalid configuration private-secret', /Could not check the Codex sign-in/]
  ]) {
    await writeFile(f.binary, `#!${process.execPath}\nconsole.error(${JSON.stringify(diagnostic)});process.exit(1);\n`, {mode:0o700});
    await assert.rejects(verifyCodexSignIn(f.binary,f.root),error=>message.test(error.message)&&!error.message.includes('private-secret'));
  }
});

test('starts the exact request without a clipboard, keeps a persistent chat, and excludes hosting credentials', async t => {
  const f = await fixture(t);
  const old = process.env.POCKETBASE_ADMIN_PASSWORD;
  process.env.POCKETBASE_ADMIN_PASSWORD = 'must-not-be-inherited';
  t.after(() => { if (old === undefined) delete process.env.POCKETBASE_ADMIN_PASSWORD; else process.env.POCKETBASE_ADMIN_PASSWORD = old; });
  const request = 'Use terracotta; preserve data. Literal $(echo unsafe) and "quotes".';
  const result = await openInCodex(f.root, request, f.options);
  assert.equal(result.ok, true);
  const job = await wait(f.root, value => !value.active);
  assert.equal(job.state, 'completed'); assert.equal(job.summary, 'Your tracker is customized.');
  assert.equal(job.thread_id, '11111111-1111-4111-8111-111111111111');
  const calls = (await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1); assert.ok(calls[0].prompt.includes(request));
  assert.ok(calls[0].prompt.includes('Do not publish')); assert.ok(calls[0].args.includes('workspace-write'));
  assert.ok(!calls[0].args.includes('--ephemeral')); assert.ok(!calls[0].args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!calls[0].keys.includes('POCKETBASE_ADMIN_PASSWORD'));
  assert.equal((await stat(join(f.root, 'CUSTOMIZE.md'))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(job).includes(f.binary)); assert.ok(!Object.hasOwn(job, 'pid'));
  assert.equal(await readFile(join(f.root, 'customized.txt'), 'utf8'), 'the exact request was submitted');
});

test('duplicate launches reuse the active task and stop works after the launch helper exits', async t => {
  const f = await fixture(t);
  const first = await openInCodex(f.root, 'Make one change [wait]', f.options);
  await wait(f.root, value => value.state === 'running');
  const second = await openInCodex(f.root, 'Do not start another writer', f.options);
  assert.equal(first.job.id, second.job.id);
  await assert.rejects(stopCodex(f.root, 'an-older-task'), /request changed/);
  assert.equal((await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.ok(!(await readFile(join(f.root, 'CUSTOMIZE.md'), 'utf8')).includes('another writer'));
  await stopCodex(f.root);
  const stopped = await wait(f.root, value => !value.active);
  assert.equal(stopped.state, 'cancelled');
  const retry = await openInCodex(f.root, 'Try a new request', f.options);
  assert.notEqual(retry.job.id, first.job.id);
  assert.equal((await wait(f.root, value => !value.active)).state, 'completed');
});

test('nonzero or incomplete runs are failures, never successful customizations', async t => {
  const f = await fixture(t);
  for (const request of ['Test [fail]', 'Test [incomplete]']) {
    await openInCodex(f.root, request, f.options);
    const job = await wait(f.root, value => !value.active);
    assert.equal(job.state, 'failed');
  }
});

test('automatic handoff is skipped on failure or cancellation, and active chats cannot open early', async t => {
  const f = await fixture(t), options = { ...f.options, openWhenFinished: true };
  await openInCodex(f.root, 'Test handoff [wait]', options);
  const running = await wait(f.root, job => job.state === 'running');
  assert.equal(running.desktop_handoff, 'pending');
  await assert.rejects(focusCodex(f.root, running.id), /still finishing/);
  await stopCodex(f.root, running.id);
  const cancelled = await wait(f.root, job => !job.active);
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.desktop_handoff, 'skipped'); assert.equal(cancelled.desktop_opened, false);
  await openInCodex(f.root, 'Test handoff [fail]', options);
  const failed = await wait(f.root, job => !job.active);
  assert.equal(failed.state, 'failed'); assert.equal(failed.desktop_handoff, 'skipped');
  await openInCodex(f.root, 'Successful edit with desktop unavailable', options);
  const ready = await wait(f.root, job => !job.active);
  assert.equal(ready.state, 'completed'); assert.equal(ready.desktop_handoff, 'failed'); assert.match(ready.message, /View in Codex/);
  await assert.rejects(openInCodex(f.root, 'Bad handoff mode', { ...f.options, openWhenFinished: 'yes' }), /open Codex when finished/);
});

test('requires existing ChatGPT sign-in and never invokes an installer or an API-key run', async t => {
  const f = await fixture(t);
  await writeFile(f.binary, `#!${process.execPath}\nconsole.error('Logged in using an API key');\n`, { mode: 0o700 });
  await assert.rejects(openInCodex(f.root, 'Customize', f.options), /Sign in to Codex with ChatGPT/);
  assert.equal(await codexTaskStatus(f.root), null);
  await assert.rejects(openInCodex(f.root, 'Customize', { getStatus: async () => ({ available: false, message: 'Install Codex first.' }) }), /Install Codex/);
});

test('request and runtime paths cannot escape the app, and thread URLs accept only IDs', async t => {
  const f = await fixture(t);
  await assert.rejects(openInCodex(f.root, '', f.options), /Describe/);
  await assert.rejects(openInCodex(f.root, 'x'.repeat(6001), f.options), /6,000/);
  const outside = join(f.root, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'request.md'), 'keep this');
  await symlink(join(outside, 'request.md'), join(f.root, 'CUSTOMIZE.md'));
  await assert.rejects(openInCodex(f.root, 'Customize', f.options), /must not be a link/);
  assert.equal(await readFile(join(outside, 'request.md'), 'utf8'), 'keep this');
  await rm(join(f.root, '.tinykit/codex'), { recursive: true });
  await symlink(outside, join(f.root, '.tinykit/codex'));
  await assert.rejects(codexTaskStatus(f.root), /stay inside/);
  assert.equal(threadURL('https://evil.example'), null); assert.equal(threadURL('../settings'), null);
  assert.equal(threadURL('11111111-1111-4111-8111-111111111111'), 'codex://threads/11111111-1111-4111-8111-111111111111');
});

test('environment allowlist retains Codex sign-in location, locale and certificates without inherited API credentials', () => {
  const environment = codexEnvironment({ HOME: '/home/user', PATH: '/usr/bin', CODEX_HOME: '/home/user/.codex', LANG: 'en_US.UTF-8', NODE_EXTRA_CA_CERTS: '/cert.pem', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_THREAD_ID: 'parent', TINYKIT_TOKEN: 'secret', POCKETBASE_ADMIN_PASSWORD: 'secret', AWS_SECRET_ACCESS_KEY: 'secret' });
  assert.deepEqual(Object.keys(environment), ['HOME', 'PATH', 'CODEX_HOME', 'LANG', 'NODE_EXTRA_CA_CERTS']);
});


test('stop also terminates commands spawned by Codex before allowing another request', async t => {
  const f = await fixture(t);
  await openInCodex(f.root, 'Test descendants [descendant] [wait]', f.options);
  await wait(f.root, value => value.state === 'running');
  await stopCodex(f.root);
  assert.equal((await wait(f.root, value => !value.active)).state, 'cancelled');
  await delay(1700);
  await assert.rejects(readFile(join(f.root, 'unwanted-write.txt')), { code: 'ENOENT' });
});

test('a CLI that disappears after sign-in becomes a failed task and can be retried', async t => {
  const f = await fixture(t);
  await writeFile(f.binary, `#!${process.execPath}\nimport {unlinkSync} from 'node:fs';unlinkSync(process.argv[1]);console.error('Logged in using ChatGPT');\n`, { mode: 0o700 });
  await openInCodex(f.root, 'Customize', f.options);
  assert.equal((await wait(f.root, value => !value.active)).state, 'failed');
});

test('abandoned task status and an empty stale launch lock recover without replacing the previous chat', async t => {
  const f = await fixture(t), base = join(f.root, '.tinykit/codex'), id = randomUUID(), folder = join(base, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(base, 'current.json'), JSON.stringify({ id }));
  await writeFile(join(folder, 'state.json'), JSON.stringify({ id, state: 'running', updated_at: '2020-01-01T00:00:00Z', thread_id: '11111111-1111-4111-8111-111111111111' }));
  assert.equal((await codexTaskStatus(f.root)).state, 'interrupted');
  const lock = join(base, 'start.lock'); await writeFile(lock, ''); await utimes(lock, new Date(0), new Date(0));
  const next = await openInCodex(f.root, 'A fresh request', f.options);
  assert.notEqual(next.job.id, id);
  assert.equal((await wait(f.root, value => !value.active)).state, 'completed');
  assert.equal(JSON.parse(await readFile(join(folder, 'state.json'), 'utf8')).thread_id, '11111111-1111-4111-8111-111111111111');
});
