import { readFile, writeFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function serverOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Server must be a bare HTTP(S) origin.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote Tinykit connections require HTTPS.');
  return url.origin;
}

const configRoot = () => resolve(process.env.TINYKIT_CONFIG_DIR || join(homedir(), '.config', 'tinykit'));
async function authFile() {
  const root = configRoot(), path = join(root, 'credentials.json');
  for (const entry of [root, path]) {
    try { if ((await lstat(entry)).isSymbolicLink()) throw new Error('Tinykit credentials must not be symlinks.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { root, path };
}
async function readAccounts() {
  const { path } = await authFile();
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.format_version !== 1 || !value.servers || typeof value.servers !== 'object' || Array.isArray(value.servers)) throw new Error('Invalid Tinykit credentials file.');
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { format_version: 1, servers: {} };
  }
}
async function saveAccounts(accounts) {
  const { root, path } = await authFile();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, `.credentials-${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function defaultServer() { return (await readAccounts()).default_server; }

export async function getToken(server, { root } = {}) {
  server = serverOrigin(server);
  const environment = process.env.TINYKIT_TOKEN || (process.env.TINYKIT_TOKEN_FILE ? (await readFile(process.env.TINYKIT_TOKEN_FILE, 'utf8')).trim() : '');
  if (environment) return environment;
  const saved = (await readAccounts()).servers[server];
  if (saved?.token) return saved.token;
  // Existing companion logins remain usable, but a fresh server-wide login
  // takes precedence over an older app-local token.
  if (root) {
    try {
      const local = JSON.parse(await readFile(join(root, '.tinykit/credentials.json'), 'utf8'));
      if (local.server === server && local.token) return local.token;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`Sign in first: tinykit login --server ${server} --email <email>`);
}

function passwordPrompt() {
  if (!process.stdin.isTTY) throw new Error('Interactive login needs a terminal. Automation can use TINYKIT_TOKEN or TINYKIT_TOKEN_FILE.');
  return new Promise((resolvePassword, reject) => {
    let password = '', done = false;
    const raw = process.stdin.isRaw, paused = process.stdin.isPaused();
    const finish = error => {
      if (done) return;
      done = true;
      process.stdin.off('data', input);
      process.stdin.setRawMode(Boolean(raw));
      if (paused) process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolvePassword(password);
    };
    const input = bytes => {
      for (const character of bytes.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Login cancelled.'));
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ') password += character;
      }
    };
    process.stdout.write('Password: ');
    process.stdin.setRawMode(true);
    process.stdin.on('data', input);
    process.stdin.resume();
  });
}

export async function login({ server, email, password, root }) {
  server = serverOrigin(server || await defaultServer());
  const secret = email ? (password ?? await passwordPrompt()) : null;
  const existing = secret === null ? await getToken(server, { root }) : null;
  const response = await fetch(`${server}/_pb/api/collections/users/${secret === null ? 'auth-refresh' : 'auth-with-password'}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(existing ? { Authorization: `Bearer ${existing}` } : {}) },
    ...(secret !== null ? { body: JSON.stringify({ identity: email, password: secret }) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.token !== 'string' || !result.token) throw new Error('Tinykit login failed. Check the server, email, and password.');
  const accounts = await readAccounts();
  accounts.servers[server] = { token: result.token };
  accounts.default_server = server;
  await saveAccounts(accounts);
  return { ok: true, server, message: `Signed in to ${server}. This login works across your local Tinykit projects.` };
}

export async function logout(server) {
  server = serverOrigin(server || await defaultServer());
  const accounts = await readAccounts();
  delete accounts.servers[server];
  if (accounts.default_server === server) accounts.default_server = Object.keys(accounts.servers)[0];
  await saveAccounts(accounts);
  return { ok: true, server, message: `Signed out of ${server}. Environment tokens and older app-local logins are managed separately.` };
}
