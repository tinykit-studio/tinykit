import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { openInAgent, openInCodex, codexTaskStatus, stopCodex, agentSessions, focusCodex } from '../scripts/companion/codex.mjs';
import { agentEnvironment } from '../scripts/companion/agent-environment.mjs';
import { claudeArguments, openClaudeSession } from '../scripts/companion/claude.mjs';

async function wait(root, predicate) {
  for (let i = 0; i < 100; i++) { const job = await codexTaskStatus(root); if (predicate(job)) return job; await delay(100); }
  throw new Error('Task did not reach the expected state.');
}
async function fixture(t, { authMethod = 'claude.ai', version = '2.1.307' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tinykit-claude-'))), binary = join(root, 'fake-agent.mjs');
  await writeFile(join(root, 'tinykit.json'), '{"format_version":1}');
  await writeFile(binary, `#!${process.execPath}\nimport{appendFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('${version} (Claude Code)');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:process.cwd()===${JSON.stringify(root)}?'${authMethod}':'api_key'}));process.exit(0);}
if(args[0]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
if(args[0]==='--desktop'){if(process.platform==='darwin'&&(!process.stdin.isTTY||!process.stdout.isTTY))process.exit(2);appendFileSync('desktop.jsonl',JSON.stringify(args)+'\\n');console.log('Opening session '+args.at(-1)+' in Claude Desktop');process.exit(0);}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
appendFileSync('calls.jsonl',JSON.stringify({args,prompt,keys:Object.keys(process.env)})+'\\n');
const emit=value=>console.log(JSON.stringify(value)),claude=args.includes('--print');
if(prompt.includes('[busy]')){console.error('thread-store conflict: thread already has an active writer');process.exit(1);}
if(prompt.includes('[missing]'))process.exit(1);
const id=prompt.includes('[wrong]')?randomUUID():claude?args[args.indexOf(args.includes('--resume')?'--resume':'--session-id')+1]:args.includes('resume')?args[args.indexOf('resume')+1]:randomUUID();
emit(claude?{type:'system',subtype:'init',session_id:id}:{type:'thread.started',thread_id:id});
if(prompt.includes('[wait]'))await new Promise(resolve=>setTimeout(resolve,30000));
if(prompt.includes('[incomplete]'))process.exit(0);
if(claude){
 emit({type:'assistant',message:{content:[{type:'text',text:'Updating the tracker.'},{type:'thinking',thinking:'Do not expose this.'}]}});
 emit({type:'result',subtype:prompt.includes('[fail]')?'error_during_execution':'success',is_error:prompt.includes('[fail]'),session_id:id,result:'Your tracker is customized.',permission_denials:prompt.includes('[deny]')?[{tool_name:'Bash'}]:[]});
}else emit({type:'turn.completed'});
writeFileSync('customized.txt','saved');
if(prompt.includes('[fail]'))process.exit(1);
`, { mode: 0o700 });
  const options = { provider: 'claude', getStatus: async () => ({ available: true, binary }), waitMs: 500 };
  t.after(async () => { const job = await codexTaskStatus(root).catch(() => null); if (job?.active) { await stopCodex(root); await wait(root, value => !value.active); } await rm(root, { recursive: true, force: true }); });
  return { root, binary, options };
}

test('Claude receives the exact stdin request, streams its result, and saves a resumable session', async t => {
  const f = await fixture(t), request = 'Make the tracker ours; literal $(touch unwanted) and "quotes".';
  const started = await openInAgent(f.root, request, f.options);
  const job = await wait(f.root, value => !value.active);
  assert.equal(job.provider, 'claude'); assert.equal(job.state, 'completed'); assert.equal(job.thread_id, started.job.id);
  assert.equal(job.summary, 'Your tracker is customized.'); assert.equal(job.request, request);
  const call = JSON.parse((await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim());
  assert.ok(call.prompt.includes(request)); assert.ok(call.prompt.includes('Do not publish'));
  assert.ok(call.args.includes('dontAsk')); assert.ok(call.args.includes('--permission-prompts')); assert.ok(!call.args.includes('--dangerously-skip-permissions'));
  assert.ok(!call.args.includes('--no-session-persistence')); assert.ok(!call.args.includes('--model'));
  assert.ok(!call.keys.includes('ANTHROPIC_API_KEY')); assert.ok(!call.keys.includes('TINYKIT_TOKEN'));
  assert.ok(!JSON.stringify(job).includes(f.binary)); assert.ok(!Object.hasOwn(job, 'pid'));
});

test('Claude and Codex share one workspace lock and current task in both directions', async t => {
  const f = await fixture(t);
  for (const firstProvider of ['claude', 'codex']) {
    const first = await openInAgent(f.root, 'One writer [wait]', { ...f.options, provider: firstProvider });
    await wait(f.root, value => value.state === 'running');
    const other = firstProvider === 'claude' ? await openInCodex(f.root, 'A competing Codex request', f.options) : await openInAgent(f.root, 'A competing Claude request', f.options);
    assert.equal(other.job.id, first.job.id); assert.equal(other.job.provider, firstProvider);
    assert.ok(!(await readFile(join(f.root, 'CUSTOMIZE.md'), 'utf8')).includes('competing'));
    await assert.rejects(stopCodex(f.root, 'stale-task'), /request changed/);
    await stopCodex(f.root, first.job.id); assert.equal((await wait(f.root, value => !value.active)).state, 'cancelled');
  }
  assert.equal((await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, 2);
});

test('permission denials, failed runs and incomplete streams never report success', async t => {
  const f = await fixture(t);
  for (const [tag, expected] of [['[deny]', 'needs_attention'], ['[fail]', 'failed'], ['[incomplete]', 'failed']]) {
    await openInAgent(f.root, 'Test ' + tag, f.options);
    assert.equal((await wait(f.root, value => !value.active)).state, expected);
  }
});

test('Claude requires a supported subscription login and rejects API-key or old CLI modes', async t => {
  const key = await fixture(t, { authMethod: 'api_key' });
  await assert.rejects(openInAgent(key.root, 'Customize', key.options), /Claude subscription/);
  assert.equal(await codexTaskStatus(key.root), null);
  const old = await fixture(t, { version: '1.0.31' });
  await assert.rejects(openInAgent(old.root, 'Customize', old.options), /2.1.285/);
  assert.equal(await codexTaskStatus(old.root), null);
  await assert.rejects(openInAgent(old.root, 'Customize', { provider: 'unknown' }), /Choose Codex or Claude Code/);
});

test('Claude uses scoped edit permissions and permits only the fixed preview status command', () => {
  const args = claudeArguments('11111111-1111-4111-8111-111111111111');
  const allowed = args[args.indexOf('--allowedTools') + 1];
  assert.match(allowed, /Edit\(\.\/\*\*\),Write\(\.\/\*\*\)/); assert.match(allowed, /status \. --json/); assert.ok(!allowed.includes('Bash(*)'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]); assert.equal(settings.disableAllHooks, true); assert.ok(settings.permissions.deny.includes('Read(./.tinykit/**)'));
  assert.ok(args.includes('--strict-mcp-config')); assert.throws(() => claudeArguments('../outside'), /Invalid/);
});

test('desktop resume uses the saved session and never submits a second prompt', async t => {
  const f = await fixture(t), id = '11111111-1111-4111-8111-111111111111';
  await openClaudeSession(f.binary, f.root, id);
  assert.deepEqual(JSON.parse((await readFile(join(f.root, 'desktop.jsonl'), 'utf8')).trim()), ['--desktop', '--resume', id]);
  await assert.rejects(openClaudeSession(f.binary, f.root, '--dangerously-skip-permissions'), /not ready/);
});

test('agent environment preserves Claude configuration without inherited provider credentials', () => {
  const env = agentEnvironment({ HOME: '/home/user', CLAUDE_CONFIG_DIR: '/home/user/.claude', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', ANTHROPIC_AUTH_TOKEN: 'secret', CLAUDECODE: 'parent-session', TINYKIT_TOKEN: 'secret', POCKETBASE_ADMIN_PASSWORD: 'secret' });
  assert.deepEqual(env, { HOME: '/home/user', CLAUDE_CONFIG_DIR: '/home/user/.claude' });
});

for (const provider of ['codex', 'claude']) {
  test(`${provider} follow-ups reuse only that provider's chat, survive reload, and can explicitly start fresh`, async t => {
    const f = await fixture(t), options = { ...f.options, provider };
    await openInAgent(f.root, 'Remember our first request.', options);
    const first = await wait(f.root, job => !job.active);
    const other = provider === 'codex' ? 'claude' : 'codex';
    await openInAgent(f.root, 'An independent conversation.', { ...options, provider: other });
    const otherJob = await wait(f.root, job => !job.active);
    await openInAgent(f.root, 'Refine the previous result.', options);
    const second = await wait(f.root, job => !job.active);
    assert.notEqual(second.id, first.id); assert.equal(second.thread_id, first.thread_id);
    assert.equal(second.turn_number, 2); assert.equal(second.state, 'completed');
    const sessions = await agentSessions(f.root);
    assert.equal(sessions[other].thread_id, otherJob.thread_id);
    assert.equal(sessions[provider].thread_id, first.thread_id);
    assert.deepEqual(sessions[provider].history.map(turn => turn.request), ['Refine the previous result.', 'Remember our first request.']);
    const calls = (await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const flag = provider === 'codex' ? 'resume' : '--resume';
    assert.equal(calls[2].args[calls[2].args.indexOf(flag) + 1], first.thread_id);
    assert.ok(!calls[2].args.includes('--last')); assert.ok(!calls[2].args.includes('--continue'));
    if (provider === 'claude') assert.ok(!calls[2].args.includes('--session-id'));
    else { assert.ok(calls[2].args.includes('workspace-write')); assert.ok(calls[2].args.includes('never')); }
    await assert.rejects(focusCodex(f.root, first.id, provider), /request changed/);
    // Loading another Node helper (as HTTP polling does) reads the same durable binding.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import{agentSessions}from${JSON.stringify(new URL('../scripts/companion/codex.mjs', import.meta.url).href)};console.log(JSON.stringify(await agentSessions(${JSON.stringify(f.root)})));`]);
    assert.equal(JSON.parse(stdout)[provider].thread_id, first.thread_id);
    await openInAgent(f.root, 'Start a separate idea.', { ...options, newChat: true });
    const fresh = await wait(f.root, job => !job.active);
    assert.notEqual(fresh.thread_id, first.thread_id); assert.equal(fresh.turn_number, 1);
    const refreshed = await agentSessions(f.root);
    assert.equal(refreshed[provider].history.length, 1); assert.equal(refreshed[other].thread_id, otherJob.thread_id);
    // Viewing a native chat must be explicit; an idle Desktop writer can block resume.
    assert.equal(fresh.desktop_opened, false);
    await openInAgent(f.root, 'Desktop owns this conversation [busy]', options);
    const busy = await wait(f.root, job => !job.active);
    assert.equal(busy.state, 'failed');
    assert.match(busy.message, provider === 'codex' ? /close that chat and retry here/ : /open or working/);
    assert.equal((await agentSessions(f.root))[provider].thread_id, fresh.thread_id);
    // A failed resume never launches a replacement or loses the last valid binding.
    await openInAgent(f.root, 'This saved CLI chat is missing [missing]', options);
    const failed = await wait(f.root, job => !job.active);
    assert.equal(failed.state, 'failed'); assert.match(failed.message, /Start new chat/);
    assert.equal((await agentSessions(f.root))[provider].thread_id, fresh.thread_id);
    assert.equal((await readFile(join(f.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, 6);
    await openInAgent(f.root, 'Reject an unexpected chat [wrong]', options);
    assert.equal((await wait(f.root, job => !job.active)).state, 'failed');
    assert.equal((await agentSessions(f.root))[provider].thread_id, fresh.thread_id);
  });
}

test('legacy chats are recovered for both providers, with no client-supplied session IDs', async t => {
  const f = await fixture(t);
  await openInAgent(f.root, 'A legacy Codex request.', { ...f.options, provider: 'codex' });
  const codex = await wait(f.root, job => !job.active);
  await openInAgent(f.root, 'A legacy Claude request.', f.options);
  const claude = await wait(f.root, job => !job.active);
  for (const provider of ['codex', 'claude']) await rm(join(f.root, '.tinykit/codex', `${provider}-chat.json`), { force: true });
  const sessions = await agentSessions(f.root);
  assert.equal(sessions.codex.thread_id, codex.thread_id); assert.equal(sessions.claude.thread_id, claude.thread_id);
  await assert.rejects(openInAgent(f.root, 'Invalid mode', { ...f.options, newChat: 'yes' }), /new chat/);
  await writeFile(join(f.root, '.tinykit/codex/claude-chat.json'), JSON.stringify({ job_id: codex.id, thread_id: codex.thread_id }));
  await assert.rejects(openInAgent(f.root, 'Wrong agent binding', f.options), /does not match/);
});
