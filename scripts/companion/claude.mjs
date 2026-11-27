import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { agentEnvironment } from './agent-environment.mjs';
const exec = promisify(execFile);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function claudeStatus() {
  const candidates = [process.env.TINYKIT_CLAUDE_BIN, join(homedir(), '.local/bin/claude'), join(homedir(), '.claude/local/node_modules/.bin/claude'), join(homedir(), '.claude/local/claude'), ...(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').map(path => join(path, process.platform === 'win32' ? 'claude.exe' : 'claude'))].filter(Boolean);
  for (const binary of [...new Set(candidates)]) try {
    await access(binary, constants.X_OK);
    let app;
    if (process.platform === 'darwin') try { await access('/Applications/Claude.app'); app = '/Applications/Claude.app'; } catch {}
    return { available: true, binary, app, desktop_available: Boolean(app) };
  } catch {}
  return { available: false, message: 'Install Claude Code and sign in with your Claude subscription, then come back here. Your project is ready.' };
}
export async function verifyClaudeSignIn(binary, directory) {
  let version, authentication;
  try { version = (await exec(binary, ['--version'], { cwd: directory, timeout: 8000, maxBuffer: 65536, env: agentEnvironment() })).stdout.match(/(\d+)\.(\d+)\.(\d+)/); } catch {}
  const [major, minor, patch] = version?.slice(1).map(Number) || [];
  if (!version || !(major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 285))))) throw new Error('Update Claude Code to version 2.1.285 or later, then try again. This workflow needs its unattended permissions and saved-session handoff.');
  try { authentication = JSON.parse((await exec(binary, ['auth', 'status'], { cwd: directory, timeout: 8000, maxBuffer: 65536, env: agentEnvironment() })).stdout); } catch {}
  if (authentication?.loggedIn !== true || authentication?.authMethod !== 'claude.ai') throw new Error('Sign in to Claude Code with your Claude subscription first, then try again. Tinykit does not use an Anthropic API key.');
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const previewStatusCommand = () => `${quote(process.execPath)} ${quote(fileURLToPath(new URL('../tinykit.mjs', import.meta.url)))} status . --json`;
export function claudeArguments(id, resumeId = null) {
  if (!uuid.test(id || '')) throw new Error('Invalid Claude Code session.');
  if (resumeId !== null && !uuid.test(resumeId || '')) throw new Error('Invalid Claude Code session.');
  return ['--print', '--verbose', '--output-format', 'stream-json', ...(resumeId ? ['--resume', resumeId] : ['--session-id', id]),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
    '--allowedTools', `Read,Edit(./**),Write(./**),Glob,Grep,Bash(${previewStatusCommand()})`,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--settings', JSON.stringify({ disableAllHooks: true, permissions: { deny: ['Read(./.tinykit/**)', 'Edit(./.tinykit/**)', 'Write(./.tinykit/**)'] } })];
}
export async function openClaudeSession(binary, directory, id) {
  if (!uuid.test(id || '')) throw new Error('The Claude Code session is not ready yet.');
  // --desktop rejects redirected output. macOS script gives this fixed CLI
  // command a PTY without opening a terminal window or sending any keystrokes.
  const launcher = process.platform === 'darwin' ? '/usr/bin/script' : binary;
  const args = [...(process.platform === 'darwin' ? ['-q', '/dev/null', binary] : []), '--desktop', '--resume', id];
  await new Promise((resolve, reject) => {
    // macOS script accepts /dev/null as stdin, but rejects the socket created
    // by execFile's default stdin pipe. No user input is needed for handoff.
    const child = spawn(launcher, args, { cwd: directory, env: agentEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', excessive = false;
    const timer = setTimeout(() => { excessive = true; child.kill('SIGTERM'); }, 15000);
    const failure = () => new Error('Claude Desktop could not open the saved session. Your request and edits are still saved in Claude Code.');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) { excessive = true; child.kill('SIGTERM'); } });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(failure()); });
    child.on('close', code => { clearTimeout(timer); if (!excessive && code === 0 && /Opening session/i.test(output)) resolve(); else reject(failure()); });
  });
}
