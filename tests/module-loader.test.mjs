import test from 'node:test';
import assert from 'node:assert/strict';
import { create_module_loader } from '../src/lib/compiler/workers/module-loader.js';

const response = (status, code = 'export const value = 1') => ({
  ok: status === 200, status, statusText: String(status), text: async () => code
});

test('recovers from temporary CDN errors and caches only the successful module', async () => {
  let calls = 0;
  const delays = [];
  const load = create_module_loader({
    fetch_module: async () => response(++calls < 3 ? 500 : 200),
    wait: async ms => delays.push(ms)
  });
  assert.equal(await load('https://esm.sh/svelte'), 'export const value = 1');
  assert.equal(await load('https://esm.sh/svelte'), 'export const value = 1');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [300, 900]);
});

test('bounds network retries and allows a later compilation to recover', async () => {
  let calls = 0;
  const load = create_module_loader({
    fetch_module: async () => { if (++calls <= 3) throw new TypeError('Network unavailable'); return response(200); },
    wait: async () => {}
  });
  await assert.rejects(load('https://esm.sh/svelte'), /Network unavailable/);
  assert.equal(calls, 3);
  assert.equal(await load('https://esm.sh/svelte'), 'export const value = 1');
  assert.equal(calls, 4);
});

test('permanent missing modules fail immediately without poisoning the cache', async () => {
  let calls = 0;
  const load = create_module_loader({
    fetch_module: async () => { calls++; return response(404); },
    wait: async () => assert.fail('404 must not retry')
  });
  await assert.rejects(load('https://esm.sh/missing'), /404/);
  await assert.rejects(load('https://esm.sh/missing'), /404/);
  assert.equal(calls, 2);
});

test('concurrent compilations share one module download', async () => {
  let finish;
  let calls = 0;
  const load = create_module_loader({ fetch_module: () => { calls++; return new Promise(resolve => finish = resolve); } });
  const first = load('https://esm.sh/svelte');
  const second = load('https://esm.sh/svelte');
  assert.equal(calls, 1);
  finish(response(200));
  assert.deepEqual(await Promise.all([first, second]), ['export const value = 1', 'export const value = 1']);
});
