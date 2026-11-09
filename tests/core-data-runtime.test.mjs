import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse } from 'acorn';

const source = readFileSync(new URL('../src/lib/compiler/iframe.js', import.meta.url), 'utf8');
const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(
  entry => entry.type === 'VariableDeclaration' && entry.declarations[0].id.name === 'generate_data_module'
);
const preview = vm.runInNewContext(source.slice(node.start, node.end) + '; generate_data_module');
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/routes/tinykit/lib/module-generators.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports });

function runtime(generate, fetch) {
  const window = {}; window.parent = window;
  return vm.runInNewContext(generate('project', ['entries']).replace('export default db', 'db'), {
    window, fetch, URLSearchParams, setTimeout, console,
    EventSource: class { addEventListener() {} }
  }).entries;
}
const response = value => ({ ok: true, json: async () => value });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

for (const [name, generate] of [['preview', preview], ['production', exports.generate_data_module]]) {
  test(`${name}: failed deletion restores its row while keeping unrelated changes`, async () => {
    let finish;
    const collection = runtime(generate, async (_url, options) => options?.method === 'DELETE'
      ? new Promise(resolve => { finish = resolve; })
      : response({ items: [{ id: 'a', text: 'Original' }, { id: 'b', text: 'Other' }] }));
    let latest;
    collection.subscribe(rows => { latest = rows; });
    await collection.list(); await flush();
    const deleting = collection.delete('a');
    const failure = assert.rejects(deleting, /Delete failed/);
    assert.deepEqual(Array.from(latest, row => row.id), ['b']);
    collection._notify([{ id: 'b', text: 'Edited elsewhere' }, { id: 'c', text: 'New' }], true);
    finish({ ok: false, text: async () => 'Delete failed' });
    await failure;
    assert.deepEqual(Array.from(latest, row => [row.id, row.text]), [
      ['a', 'Original'], ['b', 'Edited elsewhere'], ['c', 'New']
    ]);
  });

  test(`${name}: deletion waits for pending edits and failed deletion releases later edits`, async () => {
    const methods = [];
    let finishUpdate;
    const collection = runtime(generate, async (_url, options) => {
      if (!options) return response({ items: [{ id: 'a', text: 'Original' }] });
      methods.push(options.method);
      if (methods.length === 1) return new Promise(resolve => { finishUpdate = resolve; });
      if (options.method === 'DELETE') return { ok: false, text: async () => 'Offline' };
      return response({ id: 'a', ...JSON.parse(options.body) });
    });
    let latest;
    collection.subscribe(rows => { latest = rows; });
    await collection.list(); await flush();
    const update = collection.update('a', { text: 'First edit' });
    const deleting = collection.delete('a');
    const failed = assert.rejects(deleting, /Offline/);
    const final = collection.update('a', { text: 'Last edit' });
    assert.deepEqual(methods, ['PATCH']);
    finishUpdate(response({ id: 'a', text: 'First edit' }));
    await Promise.all([update, failed, final]);
    assert.deepEqual(methods, ['PATCH', 'DELETE', 'PATCH']);
    assert.equal(latest[0].text, 'Last edit');
  });

  test(`${name}: confirmed deletion removes a stale list response`, async () => {
    let finish;
    const collection = runtime(generate, async (_url, options) => options?.method === 'DELETE'
      ? new Promise(resolve => { finish = resolve; })
      : response({ items: [{ id: 'a' }] }));
    let latest;
    collection.subscribe(rows => { latest = rows; });
    await collection.list(); await flush();
    const deleting = collection.delete('a');
    await collection.list();
    finish(response({})); await deleting;
    assert.equal(latest.length, 0);
  });

  test(`${name}: initial load errors are observable and a list retry can recover`, async () => {
    let online = false;
    let error;
    const collection = runtime(generate, async () => {
      if (!online) throw new Error('Offline');
      return response({ items: [{ id: 'restored' }] });
    });
    const unsubscribe = collection.subscribe(() => assert.fail('Failed load must not look like an empty collection'), {}, value => { error = value; });
    await flush();
    assert.match(error.message, /Offline/);
    unsubscribe(); online = true;
    assert.equal((await collection.list())[0].id, 'restored');
  });

  test(`${name}: unsubscribing suppresses a pending initial response and its error`, async () => {
    for (const fails of [false, true]) {
      let finish;
      const collection = runtime(generate, () => new Promise((resolve, reject) => { finish = fails ? reject : resolve; }));
      let calls = 0;
      const unsubscribe = collection.subscribe(() => { calls++; }, {}, () => { calls++; });
      unsubscribe();
      finish(fails ? new Error('Offline') : response({ items: [{ id: 'late' }] }));
      await flush();
      assert.equal(calls, 0);
    }
  });
}
