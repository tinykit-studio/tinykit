import { readFile } from 'node:fs/promises';
import { join, dirname, delimiter, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { requireNode, installed, runtimeDirectory, childEnvironment } from './cli.mjs';
import { readSourceTree, sourceHash } from './source-tree.mjs';
import { claimWorkspace } from '../companion/dev.mjs';

const runner = fileURLToPath(new URL('./vite-runner.mjs', import.meta.url));
const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const snapshot = async root => {
  const bundle = await readSourceTree(root);
  return sourceHash(Buffer.from(bundle.files['src/App.svelte'], 'base64').toString('utf8'), bundle);
};

async function task(root, command, args, ipc = false) {
  const env = childEnvironment();
  // A caller may itself be running under node:test. Its child-runner marker
  // would suppress the app's nested tests and incorrectly report success.
  delete env.NODE_TEST_CONTEXT;
  env.PATH = dirname(process.execPath) + delimiter + (env.PATH || '');
  env.NO_COLOR = '1'; delete env.FORCE_COLOR;
  const child = spawn(command, args, { cwd: root, env, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
  let output = '', report, interrupted = false, timedOut = false, escalation;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { output = (output + value).slice(-16000); });
  child.on('message', value => { if (value.event === 'build-result') report = value; });
  const signal = name => {
    if (!child.pid) return;
    try { if (process.platform === 'win32') child.kill(name); else process.kill(-child.pid, name); } catch {}
  };
  const stop = () => {
    interrupted = true; signal('SIGTERM');
    escalation ??= setTimeout(() => signal('SIGKILL'), 2000);
    escalation.unref();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(() => { timedOut = true; stop(); }, 120000);
  try {
    const result = await new Promise(resolve => {
      child.once('error', error => resolve({ code: null, error: error.message }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    output = stripAnsi(output);
    const ok = result.code === 0 && !interrupted && (!ipc || report?.ok === true);
    const message = timedOut ? 'Check timed out after 120 seconds.' : interrupted ? 'Check interrupted.' : result.error || (result.signal ? `Process stopped by ${result.signal}.` : null);
    return { state: ok ? 'success' : 'error', exit_code: result.code, output,
      diagnostics: report?.diagnostics || [], ...(interrupted ? { interrupted: true } : {}), ...(message ? { message } : {}) };
  } finally {
    clearTimeout(timer); clearTimeout(escalation);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

export async function checkProject(root) {
  requireNode(); await installed(root);
  const runtime = await runtimeDirectory(root);
  // Checks and publications both build into dist/; don't let those writes race.
  const release = await claimWorkspace(runtime, 'component-publish.lock');
  try {
    const before = await snapshot(root);
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const build = await task(root, process.execPath, [runner, 'build', root, JSON.stringify({ json: true, report: true })], true);
    const tests = !build.interrupted && typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim()
      ? await task(root, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test'])
      : { state: 'skipped', exit_code: null, output: '', diagnostics: [], message: build.interrupted ? 'Check interrupted before tests ran.' : 'No test script is defined in package.json.' };
    const diagnostics = [];
    for (const [stage, result] of Object.entries({ build, tests })) {
      diagnostics.push(...result.diagnostics.map(item => ({ ...item, stage })));
      if (result.state === 'error' && !result.diagnostics.length) {
        const location = result.output.match(/(?:^|\n)\s*(?:test at |location:\s*["'])(?:file:\/\/)?([^\n"']+?):(\d+):(\d+)/)
          || result.output.match(/(?:^|[\s("'])(?:file:\/\/)?((?:[A-Za-z]:[\\/]|\/)[^\n"'()]+?):(\d+):(\d+)/);
        diagnostics.push({ stage, severity: 'error', message: result.message || result.output.trim() || `${stage} failed.`,
          file: location ? relative(root, resolve(root, location[1])) : null, line: location ? Number(location[2]) : null, column: location ? Number(location[3]) : null });
      }
      delete result.diagnostics;
      if (result.state === 'success') delete result.output;
    }
    if (await snapshot(root) !== before) diagnostics.push({ stage: 'source', severity: 'error',
      message: 'Source changed during the check. Save your files and run tinykit check again.', file: null, line: null, column: null });
    const ok = build.state === 'success' && tests.state !== 'error' && !diagnostics.some(item => item.severity === 'error');
    const message = `Build ${build.state}; tests ${tests.state}.` + (ok ? '' : '\n' + diagnostics.map(item => `${item.file ? `${item.file}:${item.line ?? '?'}:${item.column ?? '?'}: ` : ''}${item.message}`).join('\n'));
    return { ok, runtime: 'svelte-vite', source_hash: before, build, tests, diagnostics, message };
  } finally { await release(); }
}
