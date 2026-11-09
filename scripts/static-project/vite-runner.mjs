// The CLI owns process lifecycle; Vite uses the app's installed dependencies
// and normal project configuration. No credentials are passed to this child.
import { createRequire } from 'node:module';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, root, rawOptions] = process.argv.slice(2);
const options = JSON.parse(rawOptions);
let server, closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await server?.close();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  const require = createRequire(join(root, 'package.json'));
  const location = dirname(require.resolve('vite/package.json'));
  const vite = await import(pathToFileURL(join(location, 'dist/node/index.js')).href);
  if (mode === 'build') {
    await vite.build({ root, logLevel: options.json ? 'silent' : 'info' });
    if (options.report) process.send?.({ event: 'build-result', ok: true, diagnostics: [] });
  }
  else {
    const editReady = { name: 'tinykit-edit-ready', configureServer(server) {
      server.middlewares.use('/__tinykit/edit-ready', (request, response) => {
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ session: options.session }));
      });
    } };
    server = await vite.createServer({ root, cacheDir: join(root, '.tinykit/vite-cache'), clearScreen: false, plugins: [editReady], server: { host: '127.0.0.1', port: options.port, strictPort: true, open: false,
      fs: { deny: ['.env', '.env.*', '**/.tinykit/**', '**/.git/**'] } } });
    await server.listen();
    process.send?.({ event: 'ready', url: `http://127.0.0.1:${options.port}` });
    if (options.open) server.openBrowser();
  }
} catch (error) {
  if (options.report) {
    const location = error.loc || error.start;
    let file = location?.file || error.filename || error.id || null;
    if (file) { file = file.split('?')[0]; if (isAbsolute(file)) file = relative(root, file); }
    process.send?.({ event: 'build-result', ok: false, diagnostics: [{ severity: 'error',
      message: error.message, file, line: location?.line ?? null,
      column: typeof location?.column === 'number' ? location.column + 1 : null,
      ...(error.frame ? { frame: error.frame } : {}), ...(error.code ? { code: error.code } : {}) }] });
  }
  console.error(error.message);
  process.exitCode = 1;
}
