import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportStaticProject } from '../scripts/static-project/export.mjs';
import { claimWorkspace } from '../scripts/companion/dev.mjs';

const execute = promisify(execFile), studio = fileURLToPath(new URL('../', import.meta.url));
const supported = { skip: Number(process.versions.node.split('.')[0]) < 22 };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tinykit-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'app');
  await exportStaticProject({ id: '123456789abcdef', name: 'Check fixture', frontend_code: '<h1>Working</h1>', data: {}, content: [], design: [] }, root, 'https://unused.example');
  await symlink(join(studio, 'node_modules'), join(root, 'node_modules'), 'junction');
  return root;
}
async function cli(root, options = {}) {
  const args = ['scripts/tinykit.mjs', 'check', root, '--json', ...(options.args || [])];
  try {
    const result = await execute(process.execPath, args, { cwd: studio, env: { ...process.env, ...options.env }, maxBuffer: 1000000 });
    return { code: 0, value: JSON.parse(result.stdout) };
  } catch (error) {
    if (error.stdout) return { code: error.code, value: JSON.parse(error.stdout) };
    throw error;
  }
}
async function testScript(root, code) {
  await mkdir(join(root, 'src/lib'), { recursive: true });
  await writeFile(join(root, 'src/lib/check.test.js'), code);
  const pkg = JSON.parse(await readFile(join(root, 'package.json')));
  pkg.scripts.test = 'node --test src/lib/check.test.js';
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
}

test('check uses real Vite offline, reports skipped tests, and never signs in', supported, async t => {
  const root = await fixture(t);
  const { code, value } = await cli(root, { env: { TINYKIT_CONFIG_DIR: join(root, 'no-credentials') } });
  assert.equal(code, 0); assert.equal(value.ok, true);
  assert.equal(value.build.state, 'success'); assert.equal(value.tests.state, 'skipped');
  assert.deepEqual(value.diagnostics, []);
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /tinykit check --json/);
});

test('check reports real child-component locations and test failures, then succeeds after repair', supported, async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'src/components'));
  await writeFile(join(root, 'src/App.svelte'), '<script>import Child from "./components/Child.svelte";</script><Child />');
  await writeFile(join(root, 'src/components/Child.svelte'), '<script>\nlet broken = ;\n</script>');
  await testScript(root, "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberate failure', () => assert.equal(1, 2));\n");
  const failed = await cli(root);
  assert.equal(failed.code, 1); assert.equal(failed.value.ok, false);
  assert.equal(failed.value.build.state, 'error'); assert.equal(failed.value.tests.state, 'error');
  const build = failed.value.diagnostics.find(item => item.stage === 'build');
  assert.equal(build.file, 'src/components/Child.svelte');
  assert.equal(build.line, 2); assert.ok(build.column > 0); assert.ok(build.message);
  const tests = failed.value.diagnostics.find(item => item.stage === 'tests');
  assert.equal(tests.file, 'src/lib/check.test.js'); assert.ok(tests.line > 0);
  assert.match(failed.value.tests.output, /deliberate failure/);
  await writeFile(join(root, 'src/components/Child.svelte'), '<h1>Repaired</h1>');
  await testScript(root, "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('no credential inheritance', () => { assert.equal(process.env.TINYKIT_TOKEN, undefined); assert.equal(process.env.TINYKIT_TOKEN_FILE, undefined); });\n");
  const fixed = await cli(root, { env: { TINYKIT_TOKEN: 'must-not-reach-child', TINYKIT_TOKEN_FILE: '/not/a/credential' } });
  assert.equal(fixed.code, 0); assert.equal(fixed.value.ok, true);
  assert.equal(fixed.value.tests.state, 'success'); assert.deepEqual(fixed.value.diagnostics, []);
  assert.equal(fixed.value.tests.output, undefined);
});

test('check rejects a source mutation during tests and an overlapping publication', supported, async t => {
  const root = await fixture(t);
  await testScript(root, "import { appendFile } from 'node:fs/promises';\nawait appendFile('src/App.svelte', '\\n<p>Changed during tests</p>');\n");
  const changed = await cli(root);
  assert.equal(changed.code, 1); assert.equal(changed.value.build.state, 'success');
  assert.equal(changed.value.tests.state, 'success');
  assert.equal(changed.value.diagnostics[0].stage, 'source');
  const release = await claimWorkspace(join(root, '.tinykit'), 'component-publish.lock');
  try {
    const locked = await cli(root);
    assert.equal(locked.code, 1); assert.equal(locked.value.ok, false);
    assert.match(locked.value.error, /already|lock|running/i);
  } finally { await release(); }
  const invalid = await cli(root, { args: ['--unknown'] });
  assert.equal(invalid.code, 1); assert.match(invalid.value.error, /Usage/);
});
