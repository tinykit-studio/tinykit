import http from 'node:http';
import net from 'node:net';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { login, defaultServer, serverOrigin } from './auth.mjs';
import { launcherStore, createStarter, checkedAppDirectory } from './starter.mjs';
import { claimWorkspace } from './dev.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function parseStartArgs(args) {
  const options = { directory: join(homedir(), 'Tinykit Apps'), port: 5188, open: true };
  let directory = false;
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--server') { if (!args[i + 1]) throw new Error('--server needs an address.'); options.server = serverOrigin(args[++i]); }
    else if (value === '--port') options.port = Number(args[++i]);
    else if (value === '--no-open') options.open = false;
    else if (value.startsWith('-') || directory) throw new Error(`Unknown start argument: ${value}`);
    else { options.directory = resolve(value); directory = true; }
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('--port must be between 1024 and 65535.');
  return options;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export function guardLauncher(request, origin) {
  const headers = request.headers;
  if (headers.host !== new URL(origin).host || (headers.origin && headers.origin !== origin) || headers['sec-fetch-site'] === 'cross-site' || (request.method === 'POST' && headers.origin !== origin)) throw Object.assign(new Error('Open the local Tinykit launcher to continue.'), { status: 403 });
}
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Expected JSON.'), { status: 415 });
  let text = '';
  for await (const chunk of request) { text += chunk; if (text.length > 16000) throw Object.assign(new Error('Request too large.'), { status: 413 }); }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
}
export async function startLauncher(options) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('The Tinykit starter needs Node.js 22 or newer.');
  // A browser connection always uses the account selected in the UI.
  delete process.env.TINYKIT_TOKEN; delete process.env.TINYKIT_TOKEN_FILE;
  const store = await launcherStore(options.directory), release = await claimWorkspace(store.runtime, 'launcher.lock');
  let serverAddress = options.server || await defaultServer() || '', connected = false, busy = false;
  const origin = `http://127.0.0.1:${options.port}`, children = new Map();
  let closing = false;
  async function openApp(app) {
    const directory = await checkedAppDirectory(store, app);
    // Reuse a real running companion; never start another watcher for the folder.
    try {
      const dev = JSON.parse(await readFile(join(directory, '.tinykit/dev-server.json'), 'utf8'));
      if (dev.project_id === app.id && /^http:\/\/127\.0\.0\.1:\d+\/companion$/.test(dev.url)) {
        process.kill(dev.pid, 0);
        const response = await fetch(dev.url + '/state', { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).project?.id === app.id) return dev.url;
      }
    } catch {}
    const binary = join(packageRoot, 'pocketbase', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
    try { await access(binary); } catch {
      const downloader = spawn(process.execPath, [join(packageRoot, 'scripts/download-pocketbase.js')], { stdio: 'inherit' });
      await new Promise((resolve, reject) => { downloader.once('error', reject); downloader.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not prepare the local preview. Retry when your connection is available.'))); });
    }
    const port = await freePort();
    const child = spawn(process.execPath, [join(packageRoot, 'scripts/tinykit.mjs'), 'dev', directory, '--port', String(port), '--no-open'], { cwd: packageRoot, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
    children.set(app.id, child);
    let spawnError; child.on('error', error => { spawnError = error; });
    child.once('exit', () => { if (children.get(app.id) === child) children.delete(app.id); });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('The preview could not start. Retry to reopen the same app.');
      try {
        const dev = JSON.parse(await readFile(join(directory, '.tinykit/dev-server.json'), 'utf8'));
        if (dev.pid === child.pid && dev.project_id === app.id && dev.url === `http://127.0.0.1:${port}/companion`) return dev.url;
      } catch {}
      await delay(200);
    }
    child.kill('SIGTERM');
    throw new Error('The preview took too long to start. Retry to reopen the same app.');
  }
  const server = http.createServer(async (request, response) => {
    function json(value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); }
    try {
      guardLauncher(request, origin);
      const path = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return response.end(await readFile(join(packageRoot, 'scripts/companion/launcher.html')));
      }
      if (request.method === 'GET' && ['/launcher.js', '/launcher.css'].includes(path)) {
        response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return response.end(await readFile(join(packageRoot, 'scripts/companion', path.slice(1))));
      }
      if (request.method === 'GET' && path === '/api/state') {
        if (serverAddress && !connected) try { await login({ server: serverAddress }); connected = true; } catch {}
        return json({ ok: true, server: serverAddress, connected, busy, apps: store.index.apps.map(({ id, name, server, state, error }) => ({ id, name, server, state, error })) });
      }
      if (request.method !== 'POST' || !['/api/login', '/api/create', '/api/open'].includes(path)) return json({ ok: false, error: 'Not found.' }, 404);
      if (busy) return json({ ok: false, error: 'An app is already being prepared. Please wait for it to finish.' }, 409);
      const input = await body(request);
      // Another tab may have started an operation while this body was arriving.
      if (busy) return json({ ok: false, error: 'An app is already being prepared. Please wait for it to finish.' }, 409);
      busy = true;
      try {
        if (path === '/api/login') {
          if (typeof input.email !== 'string' || typeof input.password !== 'string' || !input.password) throw new Error('Enter your Tinykit email and password.');
          const selected = serverOrigin(input.server);
          await login({ server: selected, email: input.email, password: input.password });
          serverAddress = selected; connected = true;
          return json({ ok: true, server: serverAddress });
        }
        if (!connected) throw Object.assign(new Error('Sign in to Tinykit first.'), { status: 401 });
        let app;
        if (path === '/api/create') ({ app } = await createStarter(store, { server: serverAddress, name: input.name, request_id: input.request_id, template_id: input.template_id }));
        else {
          app = store.index.apps.find(app => app.id === input.id);
          if (!app) throw new Error('Choose an app from this launcher.');
          if (app.state !== 'ready') ({ app } = await createStarter(store, { server: app.server, name: app.name, request_id: app.request_id, template_id: app.template_id }));
        }
        return json({ ok: true, url: await openApp(app), app: { id: app.id, name: app.name } });
      } finally { busy = false; }
    } catch (error) { if (error.status === 401) connected = false; json({ ok: false, error: error.message }, error.status || 400); }
  });
  async function close() {
    if (closing) return; closing = true;
    const stopped = [...children.values()].map(child => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise(resolve => {
        const force = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.once('exit', () => { clearTimeout(force); resolve(); });
        child.kill('SIGTERM');
      });
    });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await Promise.all(stopped);
    await release();
  }
  const stop = () => { close().then(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
    console.log(`Tinykit starters: ${origin}\nYour apps: ${store.root}\nKeep this window running while you customize.`);
    if (options.open) {
      const opener = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [origin], { stdio: 'ignore' }); opener.on('error', () => {});
    }
    return { origin, close, store };
  } catch (error) { await close(); throw error; }
}
