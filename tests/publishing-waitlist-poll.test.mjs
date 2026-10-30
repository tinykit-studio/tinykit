import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const templates = Object.fromEntries(['waitlist', 'poll'].map(id => [id, JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'))]));
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function harness(id, collection, extras = {}) {
  const template = templates[id];
  let script = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(script, { ecmaVersion: 'latest', sourceType: 'module' }).body.reverse()) {
    if (node.type === 'ImportDeclaration') script = script.slice(0, node.start) + script.slice(node.end);
    else if (node.type === 'VariableDeclaration') {
      const declaration = node.declarations[0];
      if (declaration.init?.callee?.object?.name === '$derived') {
        const callback = declaration.init.arguments[0];
        script = script.slice(0, node.start) + `Object.defineProperty(globalThis, ${JSON.stringify(declaration.id.name)}, {get: () => (${script.slice(callback.start, callback.end)})()});` + script.slice(node.end);
      }
    }
  }
  const cleanup = [], mounts = [], values = new Map(), listeners = new Map();
  const window = { location: { protocol: 'https:', pathname: '/survey' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = vm.createContext({ data: { [id === 'waitlist' ? 'signups' : 'options']: collection }, content: Object.fromEntries(template.content.map(field => [slug(field.name), field.value])), $state: value => value, onDestroy: fn => cleanup.push(fn), onMount: fn => mounts.push(fn), tick: async () => {}, URL, console, window, localStorage, ...extras });
  vm.runInContext(script, context);
  return { run: code => vm.runInContext(code, context), cleanup, values, window, listeners, mount() { for (const fn of mounts) { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); } } };
}
function subscription(rows = []) {
  let receive, fail, closed = false, params;
  return { subscribe(onRows, query, onError) { receive = onRows; fail = onError; params = query; onRows(rows); return () => closed = true; }, emit: items => receive(items), fail: () => fail(Error('Offline')), get closed() { return closed; }, get params() { return params; } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const pollRows = () => [{ id: 'a', text: 'First', votes: 2, order: 0 }, { id: 'b', text: 'Second', votes: 1, order: 1 }];

for (const [id, template] of Object.entries(templates)) {
  test(`${id}: browser and published components compile without warnings and use actual CMS names`, () => {
    for (const generate of ['client', 'server']) assert.deepEqual(compile(template.frontend_code, { filename: `${id}.svelte`, generate }).warnings, []);
    const keys = new Set(template.content.map(field => slug(field.name)));
    for (const [, key] of template.frontend_code.matchAll(/\bcontent\.(\w+)/g)) assert.ok(keys.has(key), `Missing CMS field ${key}`);
  });
  test(`${id}: load errors stop loading, retries preserve action errors and cleanup ignores late reads`, async () => {
    const rows = id === 'poll' ? pollRows() : [{ id: 'one', email: 'one@example.com' }];
    const sub = subscription(rows), pending = deferred();
    let attempt = 0;
    const app = harness(id, { ...sub, list: async () => { if (++attempt === 1) throw Error('Offline'); if (attempt === 2) return rows; return pending.promise; } });
    sub.fail();
    assert.equal(app.run(id === 'waitlist' ? 'loading_signups' : 'loading'), false);
    assert.match(app.run('load_error'), /Could not load/);
    const action = id === 'poll' ? 'vote_error' : 'error';
    app.run(`${action} = 'Keep this error'`);
    await app.run('retry_load()');
    assert.match(app.run('load_error'), /Could not load/);
    assert.equal(app.run('retrying_load'), false);
    await app.run('retry_load()');
    assert.equal(app.run('load_error'), '');
    assert.equal(app.run(action), 'Keep this error');
    const retry = app.run('retry_load()');
    await app.run('retry_load()');
    app.cleanup.forEach(fn => fn());
    pending.resolve([{ id: 'late' }]); await retry;
    assert.notEqual(app.run(id === 'poll' ? 'options[0].id' : 'signups[0].id'), 'late');
    assert.equal(sub.closed, true);
  });
}

test('Waitlist rejects invalid addresses and normalizes case and whitespace before unique creation', async () => {
  const writes = [];
  const sub = subscription();
  const app = harness('waitlist', { ...sub, create: async (...args) => writes.push(args) });
  for (const email of ['', '  ', 'no-at-sign', 'a@@example.com', 'a@.com', 'a@bad..com', 'a b@example.com', 'a@example.']) {
    app.run(`email = ${JSON.stringify(email)}`); await app.run('handle_submit()');
    assert.match(app.run('error'), /valid email/);
  }
  assert.equal(writes.length, 0);
  app.run('email = "  Ada@Example.COM  "'); await app.run('handle_submit()');
  assert.equal(writes[0][0].email, 'ada@example.com');
  assert.deepEqual(Array.from(writes[0][1].unique), ['email']);
  assert.match(writes[0][0].created_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(app.run('submitted'), true);
  assert.equal(app.run('email'), '');
  assert.equal(sub.params.perPage, 100);
});

test('Waitlist catches normalized cached duplicates and server duplicates outside the visible first page', async () => {
  let writes = 0;
  const app = harness('waitlist', { ...subscription([{ id: 'existing', email: '  ADA@EXAMPLE.COM ' }]), create: async () => { writes++; const error = Error('duplicate'); error.status = 409; throw error; } });
  app.run('email = "ada@example.com"'); await app.run('handle_submit()');
  assert.equal(writes, 0);
  assert.match(app.run('error'), /already on the list/);
  app.run('email = "later-page@example.com"'); await app.run('handle_submit()');
  assert.equal(writes, 1);
  assert.match(app.run('error'), /already on the list/);
  assert.equal(app.run('email'), 'later-page@example.com');
  assert.equal(app.run('submitted'), false);
});

test('Waitlist prevents double submission, retains input on failure and retries without exposing backend errors', async () => {
  const pending = deferred();
  let calls = 0;
  const app = harness('waitlist', { ...subscription(), create: () => { calls++; return calls === 1 ? pending.promise : Promise.resolve(); } });
  app.run('email = "ada@example.com"');
  const first = app.run('handle_submit()'); await app.run('handle_submit()');
  assert.equal(calls, 1);
  pending.reject(Error('<html>Database error and internal details</html>')); await first;
  assert.equal(app.run('loading'), false);
  assert.equal(app.run('email'), 'ada@example.com');
  assert.match(app.run('error'), /could not be saved/);
  assert.doesNotMatch(app.run('error'), /html|Database/);
  await app.run('handle_submit()');
  assert.equal(calls, 2);
  assert.equal(app.run('submitted'), true);
});

test('Waitlist checks load readiness, ignores late saves and only accepts web social links', async () => {
  const pending = deferred(), sub = subscription();
  let calls = 0;
  const app = harness('waitlist', { ...sub, create: () => { calls++; return pending.promise; } });
  sub.fail(); app.run('email = "ada@example.com"'); await app.run('handle_submit()');
  assert.equal(calls, 0);
  sub.emit([]); const save = app.run('handle_submit()');
  app.cleanup.forEach(fn => fn()); pending.resolve(); await save;
  assert.equal(app.run('submitted'), false);
  assert.equal(app.run('social_url("javascript:alert(1)")'), '');
  assert.equal(app.run('social_url(" https://example.com/profile ")'), 'https://example.com/profile');
});

test('Poll saves one atomic increment per client action, then moves the existing vote without inflating totals', async () => {
  const sub = subscription(pollRows()), pending = deferred(), changes = [];
  let calls = 0;
  const app = harness('poll', { ...sub, adjust: fields => { changes.push(fields); return ++calls === 1 ? pending.promise : Promise.resolve([{ id: 'a', votes: 2 }, { id: 'b', votes: 2 }]); } });
  app.mount();
  const first = app.run('vote("a")'); await app.run('vote("b")');
  assert.equal(calls, 1);
  assert.equal(changes[0].length, 1);
  assert.equal(changes[0][0].delta, 1);
  pending.resolve([{ id: 'a', votes: 3 }]); await first;
  assert.equal(app.run('total_votes'), 4);
  assert.equal(app.run('selected_id'), 'a');
  await app.run('vote("b")'); assert.equal(calls, 1);
  app.run('reset_vote()');
  assert.equal(app.run('selected_id'), 'a');
  assert.equal(app.run('total_votes'), 4);
  await app.run('vote("b")');
  assert.equal(changes[1].length, 2);
  assert.equal(changes[1][0].id, 'a'); assert.equal(changes[1][0].delta, -1);
  assert.equal(changes[1][1].id, 'b'); assert.equal(changes[1][1].delta, 1);
  assert.equal(app.run('selected_id'), 'b');
  assert.equal(app.run('changing_vote'), false);
  assert.equal(app.run('total_votes'), 4);
});

test('Poll keeps previous selection on failed vote changes and permits retry or cancellation', async () => {
  let reject = true, calls = 0;
  const app = harness('poll', { ...subscription(pollRows()), adjust: async () => { calls++; if (reject) throw Error('Offline'); return [{ id: 'a', votes: 1 }, { id: 'b', votes: 2 }]; } });
  app.values.set('tinykit:poll:/survey', 'a'); app.mount();
  app.run('reset_vote()'); await app.run('vote("b")');
  assert.equal(app.run('selected_id'), 'a');
  assert.equal(app.run('voted'), true);
  assert.equal(app.run('changing_vote'), true);
  assert.equal(app.run('saving'), false);
  assert.equal(app.run('total_votes'), 3);
  assert.match(app.run('vote_error'), /could not be saved/);
  app.run('reset_vote()');
  assert.equal(app.run('changing_vote'), false);
  assert.equal(app.run('vote_error'), '');
  app.run('reset_vote()'); await app.run('vote("a")');
  assert.equal(calls, 1);
  assert.equal(app.run('changing_vote'), false);
  app.run('reset_vote()'); reject = false; await app.run('vote("b")');
  assert.equal(calls, 2);
  assert.equal(app.run('selected_id'), 'b');
  assert.equal(app.values.get('tinykit:poll:/survey'), 'b');
});

test('Poll choices survive unavailable local storage without treating a saved vote as failed', async () => {
  const app = harness('poll', { ...subscription(pollRows()), adjust: async () => [{ id: 'a', votes: 3 }] }, { localStorage: { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } } });
  app.mount();
  await app.run('vote("a")');
  assert.equal(app.run('voted'), true);
  assert.equal(app.run('selected_id'), 'a');
  assert.equal(app.run('vote_error'), '');
  assert.match(app.run('storage_warning'), /cannot remember/);
});

test('Poll ignores invalid/stale saved choices and confines gallery preview choices to memory', async () => {
  const app = harness('poll', { ...subscription(pollRows()) });
  app.values.set('tinykit:poll:/survey', 'missing'); app.mount();
  assert.equal(app.run('voted'), false);
  assert.equal(app.values.has('tinykit:poll:/survey'), false);
  const preview = harness('poll', { ...subscription(pollRows()), adjust: async () => [{ id: 'a', votes: 3 }] });
  preview.window.location.protocol = 'about:';
  preview.values.set('tinykit:poll:/survey', 'b'); preview.mount();
  assert.equal(preview.run('voted'), false);
  await preview.run('vote("a")');
  assert.equal(preview.values.get('tinykit:poll:/survey'), 'b');
  app.cleanup.forEach(fn => fn()); preview.cleanup.forEach(fn => fn());
  assert.equal(app.listeners.size, 0);
  assert.equal(preview.listeners.size, 0);
});

test('Poll validates saved choices once initial data arrives, clears zero-count choices and ignores late saves', async () => {
  const sub = subscription(), pending = deferred();
  const app = harness('poll', { ...sub, adjust: () => pending.promise });
  app.values.set('tinykit:poll:/survey', 'a');
  app.run('loading = true'); app.mount();
  assert.equal(app.run('voted'), true);
  sub.emit([{ id: 'a', votes: 0, text: 'First', order: 0 }]);
  assert.equal(app.run('voted'), false);
  assert.equal(app.values.has('tinykit:poll:/survey'), false);
  const save = app.run('vote("a")'); app.cleanup.forEach(fn => fn());
  pending.resolve([{ id: 'a', votes: 1 }]); await save;
  assert.equal(app.run('voted'), false);
});

test('Poll totals normalize legacy numeric strings, preserve subscription ordering and fresh apps contain no fake votes', () => {
  const rows = [{ id: 'later', votes: '2', order: 2 }, { id: 'first', votes: 3, order: 0 }, { id: 'bad', votes: 'bad', order: 1 }, { id: 'negative', votes: -5, order: 3 }];
  const app = harness('poll', subscription(rows));
  assert.equal(rows[0].id, 'later');
  assert.equal(app.run('options[0].id'), 'first');
  assert.equal(app.run('total_votes'), 5);
  assert.equal(app.run('get_percentage("2")'), 40);
  assert.equal(app.run('get_percentage(-5)'), 0);
  assert.ok(templates.poll.data.options.records.every(option => option.votes === 0));
  assert.ok(templates.poll.preview_records.options.some(option => option.votes > 0));
  assert.deepEqual(templates.waitlist.data.signups.records, []);
});

for (const id of ['waitlist', 'poll']) {
  test(`${id}: live snapshots supersede pending retries and malformed rows cannot break counts`, async () => {
    const sub = subscription(), pending = deferred();
    const app = harness(id, { ...sub, list: () => pending.promise });
    const retry = app.run('retry_load()');
    const record = { id: 'current', email: 'new@example.com', text: 'Latest', votes: 3 };
    sub.emit([null, {}, record, { ...record, text: 'Current' }]);
    record.text = 'Changed externally';
    pending.resolve([{ id: 'stale' }]); await retry;
    const rows = id === 'waitlist' ? 'signups' : 'options';
    assert.equal(app.run(`${rows}.length`), 1);
    assert.equal(app.run(`${rows}[0].id`), 'current');
    assert.equal(app.run(`${rows}[0].text`), 'Current');
    sub.emit(undefined);
    assert.equal(app.run(`${rows}.length`), 0);
    assert.equal(app.run('load_error'), '');
  });

  test(`${id}: a failed old retry cannot replace a recovered live status`, async () => {
    const sub = subscription(), pending = deferred();
    const app = harness(id, { ...sub, list: () => pending.promise });
    const retry = app.run('retry_load()');
    sub.emit([{ id: 'live' }]); pending.reject(Error('Old request failed')); await retry;
    assert.equal(app.run('load_error'), '');
    assert.equal(app.run('retrying_load'), false);
  });
}

test('Waitlist preserves a newer signup draft and ignores focus work after teardown', async () => {
  const pending = deferred();
  const app = harness('waitlist', { ...subscription(), create: () => pending.promise });
  app.run('email = "first@example.com"');
  const save = app.run('handle_submit()');
  app.run('email = "newer@example.com"'); pending.resolve(); await save;
  assert.equal(app.run('email'), 'newer@example.com');
  assert.equal(app.run('submitted'), false);
  assert.equal(app.run('loading'), false);
  app.cleanup.forEach(fn => fn());
  app.run('submitted = true'); await app.run('return_to_signup()');
  assert.equal(app.run('submitted'), true);
  assert.equal(app.run('social_url("https://exa\\nmple.com")'), '');
});

test('Poll puts unconfigured ordering last and respects clearing storage in another tab', () => {
  const app = harness('poll', subscription([{ id: 'missing', votes: 0 }, { id: 'a', votes: 2, order: 0 }, { id: 'blank', order: ' ' }, { id: 'b', votes: 1, order: 1 }]));
  app.values.set('tinykit:poll:/survey', 'a'); app.mount();
  assert.equal(app.run('options.map(option => option.id).join(",")'), 'a,b,missing,blank');
  assert.equal(app.run('voted'), true);
  app.values.clear(); app.listeners.get('storage')({ key: null });
  assert.equal(app.run('voted'), false);
  assert.equal(app.run('selected_id'), null);
});

test('Poll preserves newer live vote totals while applying unrelated returned rows', async () => {
  const pending = deferred(), sub = subscription(pollRows());
  const app = harness('poll', { ...sub, adjust: () => pending.promise });
  const save = app.run('vote("a")');
  sub.emit([{ id: 'a', text: 'First', votes: 5, order: 0 }, { id: 'b', text: 'Second', votes: 1, order: 1 }]);
  pending.resolve([{ id: 'a', votes: 3 }]); await save;
  assert.equal(app.run('options[0].votes'), 5);
  assert.equal(app.run('selected_id'), 'a');
  assert.equal(app.run('total_votes'), 6);
});

test('Poll releases an unavailable choice after failed or deleted pending votes', async () => {
  const pending = deferred(), sub = subscription(pollRows());
  const app = harness('poll', { ...sub, adjust: () => pending.promise });
  app.values.set('tinykit:poll:/survey', 'a'); app.mount(); app.run('reset_vote()');
  const save = app.run('vote("b")');
  sub.emit([{ id: 'b', votes: 1 }]); pending.reject(Error('Removed option')); await save;
  assert.equal(app.run('saving'), false);
  assert.equal(app.run('selected_id'), null);
  assert.equal(app.run('voted'), false);
  assert.equal(app.values.has('tinykit:poll:/survey'), false);

  const removed = deferred(), rows = subscription(pollRows());
  const deleted = harness('poll', { ...rows, adjust: () => removed.promise });
  const request = deleted.run('vote("a")');
  rows.emit([{ id: 'b', votes: 1 }]); removed.resolve([{ id: 'a', votes: 3 }]); await request;
  assert.equal(deleted.run('selected_id'), null);
  assert.equal(deleted.run('voted'), false);
  assert.match(deleted.run('vote_error'), /no longer available/);
});

test('Poll loads every option while Waitlist preserves its explicit capped public count', async () => {
  const rows = Array.from({ length: 121 }, (_, index) => ({ id: `option-${index}`, votes: 1 }));
  const collection = {
    subscribe(callback, params) { callback(params.all ? rows : rows.slice(0, params.perPage || 50)); return () => {}; },
    list: async params => params.all ? rows : rows.slice(0, params.perPage || 50)
  };
  const poll = harness('poll', collection), waitlist = harness('waitlist', collection);
  assert.equal(poll.run('total_votes'), 121);
  assert.equal(waitlist.run('signup_count'), 100);
  await poll.run('retry_load()'); await waitlist.run('retry_load()');
  assert.equal(poll.run('total_votes'), 121);
  assert.equal(waitlist.run('signup_count'), 100);
});
