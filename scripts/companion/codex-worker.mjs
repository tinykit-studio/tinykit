// A bounded, persistent CLI task. No HTTP listener and no shell commands.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { codexDirectory, taskFolder, codexEnvironment, threadURL, agentLabel, saveAgentSession } from './codex.mjs';
import { claudeArguments } from './claude.mjs';
import { handoffCodex } from './codex-handoff.mjs';
import { writeAtomic } from './workspace.mjs';

const [root, id] = process.argv.slice(2);
const { base } = await codexDirectory(root), folder = await taskFolder(base, id);
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 20000) throw new Error('Request too large.'); }
const { binary, app, prompt, provider = 'codex' } = JSON.parse(input);
if (!['codex', 'claude'].includes(provider)) throw new Error('Unknown coding agent.');
const label = agentLabel(provider);
let job = JSON.parse(await readFile(join(folder, 'state.json'), 'utf8'));
let saves = Promise.resolve(), child, stopping = false, timedOut = false, failed = false, completed = false, needsAttention = false, wrongSession = false, launchFailure = '', killTimer;
function startedSession(threadId) {
  if (!threadURL(threadId) || (job.resume_thread_id && threadId !== job.resume_thread_id) || (provider === 'claude' && threadId !== (job.resume_thread_id || id))) {
    wrongSession = true; failed = true; stop(); return false;
  }
  if (job.thread_id) return true;
  job.thread_id = threadId;
  const snapshot = { ...job };
  saves = saves.then(() => saveAgentSession(base, snapshot));
  return true;
}
function killTask(signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}
function save() {
  job.updated_at = new Date().toISOString();
  const snapshot = { ...job };
  saves = saves.then(() => writeAtomic(join(folder, 'state.json'), snapshot));
  return saves;
}
function classifyFailure(value) {
  if (typeof value !== 'string') return;
  if (/unexpected argument|unrecognized subcommand|unknown option/i.test(value)) launchFailure = 'Update your coding agent to a version that supports saved-chat continuation, then retry.';
  else if (/no (?:saved )?session found|session.*(?:not found|does not exist)|cannot find.*session|failed to load.*(?:session|thread)|failed to resume/i.test(value)) launchFailure = 'The saved chat is unavailable in your coding agent. Choose Start new chat to continue with your existing app.';
  else if (/session.*already in use|session.*locked|already has an active writer/i.test(value)) launchFailure = 'This chat is open or working in your coding agent. Let it finish or close its native window, then retry here.';
  else if (/operation not permitted|permission denied/i.test(value)) launchFailure = 'Your coding agent could not access its saved chat. Check its local permissions, then retry.';
  else if (/not trusted|untrusted/i.test(value)) launchFailure = 'Open this app folder in your coding agent and trust it before continuing.';
  else if (/config/i.test(value)) launchFailure = 'Your coding agent could not load its configuration. Check its settings before retrying.';
  else if (/unauthorized|authentication|401|403/i.test(value)) launchFailure = 'Check your coding agent’s subscription sign-in, then retry the saved chat.';
  else if (/connection|network|resolve|timed out/i.test(value)) launchFailure = 'Your coding agent could not connect. Check its connection and retry the saved chat.';
}
function stop(timeout = false) {
  if (stopping) return;
  stopping = true; timedOut = timeout;
  job.state = 'stopping'; job.message = timeout ? `${label} reached the time limit and is stopping.` : `Stopping ${label}…`;
  save(); killTask('SIGTERM');
  killTimer = setTimeout(() => killTask('SIGKILL'), 5000); killTimer.unref();
}
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
try {
  job.pid = process.pid; await save();
  // Keep the user's model/configuration. Workspace writes are sandboxed and
  // commands requiring more access fail instead of bypassing permissions.
  const args = provider === 'claude' ? claudeArguments(id, job.resume_thread_id || null) : ['-a', 'never', '--sandbox', 'workspace-write', '-C', root, 'exec', ...(job.resume_thread_id ? ['resume', job.resume_thread_id] : []), '--skip-git-repo-check', '--json', '-'];
  child = spawn(binary, args, { cwd: root, env: codexEnvironment(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); child.stdin.end(prompt);
  // Classify startup failures without exposing stderr, paths or credentials.
  let diagnostic = '';
  child.stderr.on('data', chunk => {
    diagnostic = (diagnostic + chunk).slice(-16000);
    classifyFailure(diagnostic);
  });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  closed.catch(() => {}); // Spawn can fail before the initial status write finishes.
  job.child_pid = child.pid; await save();
  if (stopping) killTask('SIGTERM');
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (line.length > 1000000) return;
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'error' || event.type === 'turn.failed') classifyFailure(event.message || event.error?.message);
    if (provider === 'claude') {
      if (event.type === 'system' && event.subtype === 'init') {
        if (!startedSession(event.session_id)) return;
        if (!stopping) { job.state = 'running'; job.message = 'Claude Code is working on your request. Changes appear in the preview.'; }
        save();
      }
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        const text = event.message.content.filter(block => block.type === 'text').map(block => block.text).filter(text => typeof text === 'string').join('\n');
        if (text) { job.summary = text.slice(-3000); save(); }
      }
      if (event.type === 'result') {
        completed = event.subtype === 'success' && event.is_error !== true; failed = !completed;
        needsAttention = Array.isArray(event.permission_denials) && event.permission_denials.length > 0;
        if (typeof event.result === 'string') job.summary = event.result.slice(-3000);
        save();
      }
      return;
    }
    if (event.type === 'thread.started') {
      if (!startedSession(event.thread_id)) return;
      if (!stopping) { job.state = 'running'; job.message = 'Codex is working on your request. Changes appear in the preview.'; }
      save();
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') { job.summary = event.item.text.slice(-3000); save(); }
    if (event.type === 'turn.failed') failed = true;
    if (event.type === 'turn.completed') completed = true;
  });
  const heartbeat = setInterval(() => save(), 2000);
  const cancel = setInterval(async () => {
    try { const value = JSON.parse(await readFile(join(folder, 'cancel.json'), 'utf8')); if (value.id === id) stop(); } catch {}
  }, 500);
  const limit = setTimeout(() => stop(true), 30 * 60 * 1000);
  let result;
  try { result = await closed; } finally { clearInterval(heartbeat); clearInterval(cancel); clearTimeout(limit); clearTimeout(killTimer); if (stopping) killTask('SIGKILL'); lines.close(); }
  if (wrongSession) {
    job.state = 'failed'; job.message = `${label} returned a different chat. The request was stopped; choose Start new chat to begin separately.`;
  } else if (stopping) {
    job.state = timedOut ? 'interrupted' : 'cancelled';
    job.message = timedOut ? `${label} reached the 30-minute limit. Review its chat before continuing.` : `${label} stopped. Any edits it already saved remain in your preview.`;
  } else if (needsAttention) {
    job.state = 'needs_attention'; job.message = 'Claude Code needs permission to finish. Review its update and saved chat before publishing.';
  } else if (result.code === 0 && completed && !failed && job.thread_id) {
    job.state = 'completed'; job.message = `${label} finished. Review the preview, then publish when you’re ready.`;
  } else {
    job.state = 'failed'; job.message = launchFailure || (job.resume_thread_id ? `${label} could not finish this follow-up. Retry the saved chat, or choose Start new chat.` : `${label} stopped before finishing. Review its update and saved chat, or try another request.`);
  }
  if (provider === 'codex' && job.open_when_finished && job.state === 'completed') {
    await handoffCodex(job, { released: closed, app, save });
  } else {
    if (job.open_when_finished) job.desktop_handoff = 'skipped';
    await save();
  }
} catch {
  killTask('SIGTERM');
  job.state = 'failed'; job.message = `${label} could not finish this request. Check its sign-in and saved chat for details.`;
  await save();
}
