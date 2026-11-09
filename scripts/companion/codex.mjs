import { access, readFile, writeFile, realpath, lstat, mkdir, rename, rm, open, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './workspace.mjs';
import { agentEnvironment } from './agent-environment.mjs';
import { claudeStatus, verifyClaudeSignIn, openClaudeSession, previewStatusCommand } from './claude.mjs';

const exec = promisify(execFile);
const active = new Set(['starting', 'running', 'stopping', 'handing_off']);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const candidates = () => [process.env.TINYKIT_CODEX_BIN, ...process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').map(path => join(path, process.platform === 'win32' ? 'codex.exe' : 'codex')) || [], '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex'].filter(Boolean);

// npm launchers can remain executable after their native package disappears.
// Probe the command itself rather than treating filesystem access as readiness.
export async function findCodexBinary(paths) {
  for (const binary of new Set(paths)) try {
    await access(binary, constants.X_OK);
    const result = await exec(binary, ['--version'], { timeout: 3000, maxBuffer: 65536, env: codexEnvironment() });
    if (/\bcodex(?:-cli)?\s+\d+\.\d+/i.test(result.stdout + result.stderr)) return binary;
  } catch {}
  return null;
}

export async function verifyCodexSignIn(binary, directory) {
  let authentication;
  try {
    authentication = await exec(binary, ['login', 'status'], { cwd: directory, timeout: 8000, maxBuffer: 65536, env: codexEnvironment() });
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') throw new Error('The Codex sign-in check timed out. Try again, or open Codex to check its connection.');
    const diagnostic = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (/not logged in|logged out|no (?:saved )?credentials/i.test(diagnostic)) throw new Error('Sign in to Codex with ChatGPT first using codex login, then try again.');
    if (/ENOENT|not found|cannot find module/i.test(diagnostic) || ['ENOENT', 'EACCES'].includes(error.code)) throw new Error('The Codex launcher could not start. Check the Codex installation or TINYKIT_CODEX_BIN setting, then retry.');
    if (/operation not permitted|permission denied|keychain|credential store/i.test(diagnostic)) throw new Error('Codex could not access its saved sign-in. Open Codex and check its local permissions, then retry.');
    throw new Error('Could not check the Codex sign-in. Open Codex to check its configuration, then retry.');
  }
  // Never expose CLI output: other authentication modes can print key details.
  if (!/Logged in using ChatGPT/i.test(authentication.stdout + authentication.stderr)) throw new Error('Sign in to Codex with ChatGPT first using codex login, then try again. Tinykit uses your subscription sign-in.');
}

export const codexEnvironment = agentEnvironment;
export const agentLabel = provider => provider === 'claude' ? 'Claude Code' : 'Codex';
export function agentStatus(provider = 'codex') {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Choose Codex or Claude Code.');
  return provider === 'claude' ? claudeStatus() : codexStatus();
}

export async function codexStatus() {
  if (process.platform !== 'darwin') return { available: false, message: 'Open this project folder in your coding agent. Desktop handoff is available on macOS.' };
  const apps = [];
  for (const app of ['/Applications/ChatGPT.app', '/Applications/Codex.app']) try { await access(app); apps.push(app); } catch {}
  if (!apps.length) return { available: false, message: 'Install the Codex desktop app and sign in with ChatGPT, then come back here. Your project is ready.' };
  const binary = await findCodexBinary(process.env.TINYKIT_CODEX_BIN ? [process.env.TINYKIT_CODEX_BIN] : candidates());
  if (binary) return { available: true, binary, app: apps.find(app => binary.startsWith(app + '/')) || apps[0] };
  return { available: false, message: process.env.TINYKIT_CODEX_BIN ? 'The configured Codex launcher could not start. Check TINYKIT_CODEX_BIN, then retry.' : 'No working Codex launcher was found. Open or update Codex, then retry. You can also open this project folder directly.' };
}

export const threadURL = id => uuid.test(id || '') ? `codex://threads/${id}` : null;
export async function openCodexThread(app, id) {
  const url = threadURL(id);
  if (!url) throw new Error('The Codex chat is not ready yet.');
  await exec('/usr/bin/open', ['-a', app, url], { timeout: 10000, maxBuffer: 65536, env: codexEnvironment() });
}

export async function codexDirectory(directory) {
  const root = await realpath(directory);
  const runtime = join(root, '.tinykit');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (await realpath(runtime) !== runtime) throw new Error('.tinykit/ must stay inside this app.');
  // Retain the original folder so in-flight Codex tasks share the same lock
  // and current-task pointer with Claude Code after an upgrade.
  const base = join(runtime, 'codex');
  await mkdir(base, { mode: 0o700, recursive: true });
  if (await realpath(base) !== base) throw new Error('The Codex task folder must stay inside this app.');
  return { root, base };
}
export async function taskFolder(base, id) {
  if (!uuid.test(id || '')) throw new Error('Invalid Codex task.');
  const path = join(base, id);
  if (await realpath(path) !== path) throw new Error('The Codex task must stay inside this app.');
  return path;
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
async function currentTask(directory) {
  const { root, base } = await codexDirectory(directory);
  let current;
  try { current = JSON.parse(await readFile(join(base, 'current.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return { root, base, job: null }; throw error; }
  const folder = await taskFolder(base, current.id);
  const job = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8'));
  if (job.id !== current.id) throw new Error('The Codex task state does not match this app.');
  // A restart cannot turn an abandoned task into a permanent disabled button.
  // If the runner died but Codex is still alive, keep the task active.
  if (active.has(job.state) && !alive(job.pid) && !alive(job.child_pid) && Date.now() - Date.parse(job.updated_at) > 5000) {
    job.state = 'interrupted'; job.message = `${agentLabel(job.provider)} stopped before finishing. You can open its chat or start another request.`;
  }
  return { root, base, folder, job };
}
export async function codexTaskStatus(directory) {
  if (!directory) return null;
  const { job } = await currentTask(directory);
  if (!job) return null;
  // Never return process IDs, launch commands, executable paths or raw logs.
  return publicJob(job);
}

function publicJob(job) {
  return { id: job.id, provider: job.provider || 'codex', state: job.state, active: active.has(job.state), thread_id: threadURL(job.thread_id) ? job.thread_id : null, desktop_opened: job.desktop_opened === true, desktop_handoff: job.desktop_handoff || null, open_when_finished: typeof job.open_when_finished === 'boolean' ? job.open_when_finished : null, request: job.request || '', message: job.message, summary: job.summary || '', started_at: job.started_at, turn_number: job.turn_number || 1, new_chat: job.new_chat === true };
}

async function readJob(base, id, provider) {
  const folder = await taskFolder(base, id);
  const job = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8'));
  if (job.id !== id || (job.provider || 'codex') !== provider) throw new Error('The saved chat does not match this app and agent.');
  return job;
}

// Separate pointers preserve each agent's chat when the user switches agents.
// Workers update only their provider's pointer after the CLI confirms its ID.
export async function saveAgentSession(base, job) {
  if (!['codex', 'claude'].includes(job.provider) || !threadURL(job.thread_id) || !uuid.test(job.id)) throw new Error('Invalid saved agent chat.');
  await writeAtomic(join(base, `${job.provider}-chat.json`), { job_id: job.id, thread_id: job.thread_id });
}

export async function agentSessions(directory) {
  if (!directory) return { codex: null, claude: null };
  const { base } = await codexDirectory(directory);
  const result = { codex: null, claude: null };
  let legacy;
  for (const provider of ['codex', 'claude']) {
    let binding, job;
    try { binding = JSON.parse(await readFile(join(base, `${provider}-chat.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('The saved chat could not be read. Restore its local metadata before continuing.'); }
    if (binding) {
      job = await readJob(base, binding.job_id, provider);
      if (!threadURL(binding.thread_id) || binding.thread_id !== job.thread_id) throw new Error('The saved chat does not match this app and agent.');
    } else {
      // Upgrade existing companions, including the non-current agent's chat.
      legacy ??= await Promise.all((await readdir(base)).filter(id => uuid.test(id)).map(async id => {
        try { const folder = await taskFolder(base, id); const value = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8')); return value.id === id ? value : null; } catch { return null; }
      }));
      job = legacy.filter(item => item && uuid.test(item.id) && (item.provider || 'codex') === provider && threadURL(item.thread_id)).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
      if (!job) continue;
    }
    const history = [], seen = new Set();
    let turn = job;
    while (turn && history.length < 3 && !seen.has(turn.id)) {
      seen.add(turn.id);
      history.push({ ...publicJob(turn), request: (turn.request || '').slice(0, 1000), summary: (turn.summary || '').slice(-1500) });
      if (!turn.previous_job_id) break;
      turn = await readJob(base, turn.previous_job_id, provider);
      if (turn.thread_id !== job.thread_id) break;
    }
    result[provider] = { job_id: job.id, thread_id: job.thread_id, turn_count: job.turn_number || 1, history };
  }
  return result;
}

async function startLock(base) {
  const path = join(base, 'start.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.writeFile(String(process.pid)); await file.close();
      return () => rm(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path, 'utf8'));
      if (alive(pid) || (!pid && Date.now() - (await stat(path)).mtimeMs < 30000)) throw new Error('A customization is already starting. Wait a moment and try again.');
      await rm(path, { force: true });
    }
  }
  throw new Error('A customization is already starting.');
}

export async function openInCodex(directory, request, options = {}) {
  return openInAgent(directory, request, { ...options, provider: 'codex' });
}
export async function openInAgent(directory, request, { provider = 'codex', newChat = false, openWhenFinished = false, getStatus = () => agentStatus(provider), waitMs = 7000 } = {}) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Choose Codex or Claude Code.');
  if (typeof newChat !== 'boolean') throw new Error('Choose whether to start a new chat.');
  if (typeof openWhenFinished !== 'boolean' || (openWhenFinished && provider !== 'codex')) throw new Error('Choose whether to open Codex when finished.');
  const label = agentLabel(provider);
  const root = await realpath(directory);
  const config = JSON.parse(await readFile(join(root, 'tinykit.json'), 'utf8'));
  if (config.format_version !== 1) throw new Error('Open this app with its supported Tinykit companion.');
  if (typeof request !== 'string' || !request.trim() || request.length > 6000) throw new Error('Describe the change you want first (up to 6,000 characters).');
  const status = await getStatus();
  if (!status.available) throw new Error(status.message);
  const { base } = await codexDirectory(root);
  const release = await startLock(base);
  try {
    const existing = await codexTaskStatus(root);
    if (existing?.active) return { ok: true, job: existing, message: `${agentLabel(existing.provider)} is already working on this app. Follow its progress before starting another request.` };
    const sessions = await agentSessions(root);
    // Persist legacy bindings while holding the start lock. The worker will
    // replace only its own binding once the requested chat actually starts.
    for (const savedProvider of ['codex', 'claude']) if (sessions[savedProvider]) {
      const saved = sessions[savedProvider];
      await saveAgentSession(base, { provider: savedProvider, id: saved.job_id, thread_id: saved.thread_id });
    }
    const session = newChat ? null : sessions[provider];
    if (provider === 'claude') await verifyClaudeSignIn(status.binary, root);
    else await verifyCodexSignIn(status.binary, root);
    const path = join(root, 'CUSTOMIZE.md');
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('CUSTOMIZE.md must not be a link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const prompt = `Implement this Tinykit customization request:\n\n${request.trim()}\n\nRead AGENTS.md and instructions.md first. The Tinykit companion is already running. Edit the source files and verify the current preview using the status command in AGENTS.md. Preserve all existing records and app identity. Do not read credentials or change .tinykit/. Do not install dependencies or start another server. Do not publish; the user reviews and publishes in the companion.\n${provider === 'claude' ? `Use this exact permitted command to verify the current preview: ${previewStatusCommand()}. Do not use other shell commands.\n` : ''}`;
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `# Current customization request\n\n${prompt}`, { mode: 0o600, flag: 'wx' }); await rename(temporary, path);
    const id = randomUUID(), folder = join(base, id), now = new Date().toISOString();
    await mkdir(folder, { mode: 0o700 });
    const initial = { id, provider, new_chat: newChat, open_when_finished: openWhenFinished, desktop_handoff: openWhenFinished ? 'pending' : null, request: request.trim(), resume_thread_id: session?.thread_id || null, previous_job_id: session?.job_id || null, turn_number: session ? session.turn_count + 1 : 1, state: 'starting', started_at: now, updated_at: now, message: session ? `Continuing your chat in ${label}…` : `Starting your customization in ${label}…` };
    await writeAtomic(join(folder, 'state.json'), initial);
    await writeAtomic(join(base, 'current.json'), { id });
    const worker = spawn(process.execPath, [fileURLToPath(new URL('./codex-worker.mjs', import.meta.url)), root, id], { cwd: root, env: codexEnvironment(), detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
      await writeAtomic(join(folder, 'state.json'), { ...initial, pid: worker.pid });
      worker.stdin.on('error', () => {});
      worker.stdin.end(JSON.stringify({ binary: status.binary, app: openWhenFinished ? status.app : undefined, prompt, provider }));
      worker.unref();
    } catch {
      await writeAtomic(join(folder, 'state.json'), { ...initial, state: 'failed', updated_at: new Date().toISOString(), message: `${label} could not start. Your project files are safe; try again.` });
      worker.kill('SIGTERM');
      throw new Error(`${label} could not start. Try again.`);
    }
    // Return promptly; the detached runner owns the whole task, desktop handoff,
    // and final status even if this HTTP request or the browser goes away.
    const deadline = Date.now() + waitMs;
    let job;
    do { await delay(100); job = await codexTaskStatus(root); } while (job.state === 'starting' && Date.now() < deadline);
    return { ok: true, job, message: job.message };
  } finally { await release(); }
}

export async function focusCodex(directory, expectedId, provider) {
  if (provider !== undefined && !['codex', 'claude'].includes(provider)) throw new Error('Choose Codex or Claude Code.');
  const current = await codexTaskStatus(directory);
  const job = provider ? (await agentSessions(directory))[provider]?.history[0] : current;
  if (expectedId !== undefined && job?.id !== expectedId) throw new Error('The current customization request changed. Refresh before opening it.');
  const label = agentLabel(job?.provider);
  if (current?.active && current.provider === (job?.provider || 'codex')) throw new Error(`${label} is still finishing this request. Open its saved chat after it finishes so the chat is available to continue.`);
  const status = await agentStatus(job?.provider);
  if (!status.available) throw new Error(status.message);
  if (job?.provider === 'claude') {
    if (!status.desktop_available) throw new Error('Install Claude Desktop to open the saved chat. Your Claude Code session and edits are already saved.');
    await openClaudeSession(status.binary, directory, job.thread_id);
  } else await openCodexThread(status.app, job?.thread_id);
  return { ok: true, job, message: `Opened your customization chat in ${label}.` };
}
export async function stopCodex(directory, expectedId) {
  const { folder, job } = await currentTask(directory);
  if (expectedId !== undefined && job?.id !== expectedId) throw new Error('The current customization request changed. Refresh before stopping it.');
  if (!job || !active.has(job.state)) return { ok: true, job: await codexTaskStatus(directory) };
  await writeAtomic(join(folder, 'cancel.json'), { id: job.id });
  return { ok: true, job: await codexTaskStatus(directory), message: `Stopping ${agentLabel(job.provider)}…` };
}
