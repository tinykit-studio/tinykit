import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { localBackend } from '../scripts/static-project/local-backend.mjs';

const project = '123456789abcdef';
const path = name => `/_tk/data/${project}/${name}`;
const schema = { signups: [{ name: 'email', type: 'text' }, { name: 'group', type: 'text' }], options: [{ name: 'text', type: 'text' }, { name: 'votes', type: 'number' }] };
const seeds = { signups: [], options: [{ id: 'a', text: 'First', votes: 2 }, { id: 'b', text: 'Second', votes: 1 }] };
async function fixture(t, records = seeds) {
  const root = await mkdtemp(join(tmpdir(), 'tinykit-publishing-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([writeFile(join(root, 'schema.json'), JSON.stringify(schema)), writeFile(join(root, 'seeds.json'), JSON.stringify(records))]);
  return { root, request: middleware(root) };
}
function middleware(root) {
  let handler;
  localBackend(root, { project_id: project }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  return (url, method = 'GET', body, options = {}) => new Promise((resolve, reject) => {
    const req = Readable.from(options.raw !== undefined ? [options.raw] : body === undefined ? [] : [JSON.stringify(body)]);
    req.url = url; req.method = method;
    req.headers = { host: '127.0.0.1:5180', 'content-type': 'application/json', ...options.headers };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(value) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(value) }); } };
    handler(req, res, () => reject(Error('Unexpected fallthrough')));
  });
}

function assertError(result, status, message) {
  assert.equal(result.status, status);
  assert.equal(typeof result.body.message, 'string');
  if (message) assert.match(result.body.message, message);
}

test('Exported Waitlist loads a capped first page with truthful totals and supports later pages', async t => {
  const records = { ...seeds, signups: Array.from({ length: 105 }, (_, index) => ({ id: `signup-${index}`, email: `person-${index}@example.com` })) };
  const { request } = await fixture(t, records);
  const initial = await request(`${path('signups')}?page=1&perPage=100`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.items.length, 100);
  assert.equal(initial.body.totalItems, 105);
  assert.equal(initial.body.totalPages, 2);
  const next = await request(`${path('signups')}?page=2&perPage=100`);
  assert.equal(next.body.items.length, 5);
  assert.equal(next.body.items[0].id, 'signup-100');
  assert.equal((await request(`${path('signups')}?perPage=1000`)).body.perPage, 100);
  assert.equal((await request(path('signups'))).body.items.length, 50);
  for (const query of ['filter=email', 'sort=email', 'expand=email', 'page=invalid']) assertError(await request(`${path('signups')}?${query}`), 400);
});

test('Exported Waitlist uniqueness normalizes existing case and whitespace, including later pages and concurrent requests', async t => {
  const records = { ...seeds, signups: Array.from({ length: 101 }, (_, index) => ({ id: `existing-${index}`, email: index === 100 ? '  ADA@Example.COM  ' : `person-${index}@example.com` })) };
  const { root, request } = await fixture(t, records);
  assertError(await request(`${path('signups')}?unique=email`, 'POST', { email: 'ada@example.com' }), 409, /already exists/);
  const results = await Promise.all([
    request(`${path('signups')}?unique=email`, 'POST', { email: 'NEW@example.com' }),
    request(`${path('signups')}?unique=email`, 'POST', { email: ' new@EXAMPLE.COM ' })
  ]);
  assert.deepEqual(results.map(result => result.status), [201, 409]);
  const stored = JSON.parse(await readFile(join(root, '.tinykit', 'local-data.json'), 'utf8'));
  assert.equal(stored.signups.length, 102);
  assert.equal((await middleware(root)(path('signups'))).body.totalItems, 102);
});

test('Exported unique creation validates field names, scalar values and tuples without altering ordinary CRUD', async t => {
  const { request } = await fixture(t);
  for (const [query, body] of [
    ['unique=', { email: 'a@example.com' }], ['unique=email.bad', { email: 'a@example.com' }],
    ['unique=email', {}], ['unique=email', { email: null }], ['unique=email', { email: '  ' }],
    ['unique=email', { email: [] }], ['unique=email', { email: {} }],
    [Array.from({ length: 9 }, () => 'unique=email').join('&'), { email: 'a@example.com' }]
  ]) assertError(await request(`${path('signups')}?${query}`, 'POST', body), 400);
  assert.equal((await request(`${path('signups')}?unique=email&unique=group`, 'POST', { email: 'ada@example.com', group: 'A' })).status, 201);
  assert.equal((await request(`${path('signups')}?unique=email&unique=group`, 'POST', { email: 'ADA@example.com', group: 'B' })).status, 201);
  assertError(await request(`${path('signups')}?unique=email&unique=group`, 'POST', { email: ' ada@example.com ', group: ' a ' }), 409);
  assert.equal((await request(`${path('signups')}?unique=email`, 'POST', { email: false })).status, 201);
  assert.equal((await request(`${path('signups')}?unique=email`, 'POST', { email: 0 })).status, 201);
  const created = await request(path('signups'), 'POST', { id: 'ordinary', email: 'ada@example.com' });
  assert.equal(created.status, 201);
  assertError(await request(path('signups'), 'POST', { id: 'ordinary' }), 409);
  const edited = await request(`${path('signups')}/ordinary`, 'PATCH', { id: 'different', email: 'changed@example.com' });
  assert.equal(edited.body.id, 'ordinary');
  assert.equal(edited.body.email, 'changed@example.com');
  assert.equal((await request(`${path('signups')}/ordinary`, 'DELETE')).status, 200);
  assertError(await request(`${path('signups')}/ordinary`), 404);
});

test('Exported Poll batches counter moves atomically and preserves concurrent increments', async t => {
  const { root, request } = await fixture(t);
  const adjustPath = `${path('options')}/_adjust`;
  const results = await Promise.all(Array.from({ length: 12 }, () => request(adjustPath, 'POST', [{ id: 'a', field: 'votes', delta: 1 }])));
  assert.ok(results.every(result => result.status === 200));
  assert.equal((await request(`${path('options')}/a`)).body.votes, 14);
  const moved = await request(adjustPath, 'POST', [{ id: 'a', field: 'votes', delta: -1 }, { id: 'b', field: 'votes', delta: 1 }]);
  assert.deepEqual(moved.body.map(row => [row.id, row.votes]), [['a', 13], ['b', 2]]);
  const stored = JSON.parse(await readFile(join(root, '.tinykit', 'local-data.json'), 'utf8'));
  assert.equal(stored.options.reduce((sum, row) => sum + row.votes, 0), 15);
  const restarted = middleware(root);
  assert.equal((await restarted(`${path('options')}/a`)).body.votes, 13);
});

test('Exported counter batches validate all changes before saving and match server bounds and errors', async t => {
  const { request } = await fixture(t);
  const adjustPath = `${path('options')}/_adjust`;
  const valid = { id: 'a', field: 'votes', delta: 1 };
  for (const changes of [null, {}, [], Array.from({ length: 21 }, () => valid), [null], [{ ...valid, id: '' }], [{ ...valid, id: 1 }], [{ ...valid, field: 'text' }], [{ ...valid, field: 'missing' }], [{ ...valid, field: 'id' }], [{ ...valid, delta: 1.5 }], [{ ...valid, delta: 1000001 }], [{ ...valid, delta: '1' }]]) {
    assertError(await request(adjustPath, 'POST', changes), 400);
  }
  assertError(await request(adjustPath, 'POST', [valid, { ...valid, id: 'missing' }]), 404, /Record not found/);
  assert.equal((await request(`${path('options')}/a`)).body.votes, 2);
  const floored = await request(adjustPath, 'POST', [{ ...valid, delta: -1000000 }]);
  assert.equal(floored.body[0].votes, 0);
  const repeated = await request(adjustPath, 'POST', [valid, valid]);
  assert.equal(repeated.body.length, 1);
  assert.equal(repeated.body[0].votes, 2);
});

test('Exported counter handling accepts legacy numeric strings and rejects unsafe or non-integer values', async t => {
  const { request } = await fixture(t, { ...seeds, options: [{ id: 'string', votes: '2' }, { id: 'unsafe', votes: Number.MAX_SAFE_INTEGER }, { id: 'bad', votes: 'broken' }, { id: 'fraction', votes: 1.5 }, { id: 'empty' }] });
  const adjustPath = `${path('options')}/_adjust`;
  const apply = id => request(adjustPath, 'POST', [{ id, field: 'votes', delta: 1 }]);
  assert.equal((await apply('string')).body[0].votes, 3);
  assert.equal((await apply('empty')).body[0].votes, 1);
  for (const id of ['unsafe', 'bad', 'fraction']) assertError(await apply(id), 400, /safe integer/);
  assert.equal((await request(`${path('options')}/unsafe`)).body.votes, Number.MAX_SAFE_INTEGER);
});

test('Exported mutation endpoints preserve method/origin boundaries and return readable JSON errors', async t => {
  const { request } = await fixture(t);
  const adjustPath = `${path('options')}/_adjust`;
  for (const method of ['GET', 'PATCH', 'DELETE']) assertError(await request(adjustPath, method, []), 405);
  assertError(await request(adjustPath, 'POST', [{ id: 'a', field: 'votes', delta: 1 }], { headers: { origin: 'https://elsewhere.example' } }), 403);
  assertError(await request(adjustPath, 'POST', undefined, { raw: '{' }), 400, /Invalid JSON/);
  assertError(await request(`${path('signups')}?unique=email`, 'POST', undefined, { raw: '{' }), 400, /Invalid JSON/);
  assertError(await request(`${path('signups')}?unsupported=value`, 'POST', { email: 'a@example.com' }), 400);
  assertError(await request('/_tk/data/anotherproject/options/_adjust', 'POST', []), 404);
  assertError(await request(`${path('options')}/a?unique=email`, 'PATCH', {}), 400);
  assertError(await request(adjustPath, 'POST', [], { headers: { 'content-type': 'text/plain' } }), 415);
});

test('The generated export data client can load, uniquely create and atomically adjust through the local backend', async t => {
  const { request } = await fixture(t);
  const source = await readFile(new URL('../src/routes/tinykit/lib/module-generators.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { generate_data_module } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const context = { console, window: {}, EventSource: class { addEventListener() {} }, URLSearchParams,
    fetch: async (url, options = {}) => {
      const result = await request(url, options.method || 'GET', options.body ? JSON.parse(options.body) : undefined);
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body, text: async () => JSON.stringify(result.body) };
    } };
  runInNewContext(generate_data_module(project, ['signups', 'options']).replace('export default db', 'globalThis.db = db'), context);
  assert.equal((await context.db.signups.list({ page: 1, perPage: 100 })).length, 0);
  await context.db.signups.create({ email: 'Ada@example.com' }, { unique: ['email'] });
  await assert.rejects(context.db.signups.create({ email: ' ada@EXAMPLE.COM ' }, { unique: ['email'] }), error => error.status === 409 && /already exists/.test(error.message));
  await context.db.options.list();
  const updated = await context.db.options.adjust([{ id: 'a', field: 'votes', delta: -1 }, { id: 'b', field: 'votes', delta: 1 }]);
  assert.deepEqual(updated.map(record => [record.id, record.votes]), [['a', 1], ['b', 2]]);
  await assert.rejects(context.db.options.adjust([{ id: 'missing', field: 'votes', delta: 1 }]), error => error.status === 404 && /Record not found/.test(error.message));
});
