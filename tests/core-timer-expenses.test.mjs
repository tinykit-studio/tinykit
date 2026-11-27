import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const template = name => JSON.parse(readFileSync(new URL(`../src/lib/templates/${name}.json`, import.meta.url), 'utf8'));

function harness(name, collection, options = {}) {
  const source = template(name);
  let script = source.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(script, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(node => node.type === 'ImportDeclaration').reverse()) {
    script = script.slice(0, node.start) + script.slice(node.end);
  }
  let clock = Date.parse('2026-10-21T12:00:00.000Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const timers = new Map();
  const cleanup = [];
  let nextTimer = 0;
  const context = vm.createContext({
    data: { [name === 'timer' ? 'sessions' : 'transactions']: collection },
    content: Object.fromEntries(source.content.map(field => [field.id, field.value])),
    $state: value => value,
    // Keep derived expressions callable so assertions can observe later mutations.
    $derived: { by: callback => callback },
    onDestroy: callback => cleanup.push(callback),
    Date: ClockDate, console, window: options.window || {},
    setInterval: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval: id => timers.delete(id),
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(script, context);
  return {
    run: source => vm.runInContext(source, context),
    advance: milliseconds => { clock += milliseconds; },
    tick: () => [...timers.values()].forEach(callback => callback()),
    timers, cleanup
  };
}

for (const name of ['timer', 'expense']) {
  test(`${name}: compiles for browser and publishing without warnings`, () => {
    const source = template(name);
    for (const generate of ['client', 'server']) {
      const result = compile(source.frontend_code, { filename: `${name}.svelte`, generate });
      assert.deepEqual(result.warnings, []);
    }
  });
}

test('Focus timer catches up after delayed ticks, preserves paused milliseconds and completes exactly once', async () => {
  const writes = [];
  const app = harness('timer', { subscribe(callback) { callback([]); return () => {}; }, create: async value => writes.push(value) });
  app.run('task_name = "Write release notes"; toggle_timer()');
  app.advance(600400);
  app.tick();
  assert.equal(app.run('time_left'), 900);
  app.run('toggle_timer()');
  assert.equal(app.timers.size, 0);
  app.advance(3600000);
  assert.equal(app.run('time_left'), 900);
  app.run('toggle_timer()');
  app.advance(899599);
  app.tick();
  assert.equal(app.run('time_left'), 1);
  app.advance(1);
  app.tick();
  await app.run('complete_timer()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].task_name, 'Write release notes');
  assert.equal(writes[0].duration, 1500);
  assert.equal(writes[0].type, 'work');
  assert.equal(app.run('is_running'), false);
  assert.equal(app.run('is_work'), false);
  assert.equal(app.run('time_left'), 300);
  assert.equal(app.timers.size, 0);
});

test('Focus timer resets and closes without recording unfinished sessions', () => {
  let unsubscribed = false;
  const writes = [];
  const app = harness('timer', { subscribe(callback) { callback([]); return () => { unsubscribed = true; }; }, create: async value => writes.push(value) });
  app.run('toggle_timer()');
  app.advance(2100);
  app.tick();
  app.run('reset_timer()');
  assert.equal(app.run('time_left'), 1500);
  assert.equal(app.run('is_running'), false);
  assert.equal(app.timers.size, 0);
  app.run('toggle_timer()');
  app.cleanup.forEach(callback => callback());
  assert.equal(app.timers.size, 0);
  assert.equal(unsubscribed, true);
  assert.equal(writes.length, 0);
});

test('Focus timer advances after a failed history save and retries the original record once', async () => {
  const writes = [];
  let reject = true;
  const app = harness('timer', {
    subscribe(callback) { callback([]); return () => {}; },
    async create(value) { if (reject) throw new Error('Offline'); writes.push(value); }
  });
  app.run('task_name = "First task"; toggle_timer()');
  await app.run('complete_timer()');
  assert.equal(app.run('is_work'), false);
  assert.equal(app.run('time_left'), 300);
  assert.match(app.run('save_error'), /could not be saved/);
  assert.equal(app.run('pending_sessions.length'), 1);
  app.run('task_name = "Changed task"');
  reject = false;
  await app.run('save_pending_sessions()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].task_name, 'First task');
  assert.equal(app.run('pending_sessions.length'), 0);
  assert.equal(app.run('save_error'), '');
  await app.run('save_pending_sessions()');
  assert.equal(writes.length, 1);
});

test('Focus timer only requests notifications explicitly and tolerates browser restrictions', async () => {
  let requests = 0;
  class Notification {
    static permission = 'default';
    static async requestPermission() { requests++; throw new Error('Blocked'); }
    constructor() { throw new Error('Unsupported in iframe'); }
  }
  const app = harness('timer', { subscribe(callback) { callback([]); return () => {}; }, create: async () => {} }, { window: { Notification } });
  app.run('toggle_timer(); toggle_timer()');
  assert.equal(requests, 0);
  await app.run('request_notification_permission()');
  assert.equal(requests, 1);
  assert.match(app.run('notification_error'), /unavailable/);
  Notification.permission = 'granted';
  app.run('toggle_timer()');
  await app.run('complete_timer()');
  assert.equal(app.run('is_work'), false);
});

test('Focus timer only includes sessions from the current local date', () => {
  const app = harness('timer', {
    subscribe(callback) {
      callback([
        { id: 'today', completed_at: '2026-10-21T11:00:00Z', duration: 1500, type: 'work' },
        { id: 'yesterday', completed_at: '2026-10-20T11:00:00Z', duration: 1500, type: 'work' },
        { id: 'tomorrow', completed_at: '2026-10-22T11:00:00Z', duration: 1500, type: 'work' }
      ]);
      return () => {};
    }
  });
  assert.equal(app.run('today_sessions().length'), 1);
  assert.equal(app.run('today_sessions()[0].id'), 'today');
});

test('Expenses validates whole amounts and stores exact cents without accepting partial numbers', async () => {
  const writes = [];
  const app = harness('expense', { subscribe(callback) { callback([]); return () => {}; }, create: async value => writes.push(value) });
  app.run('new_text = "Coffee"');
  for (const value of ['', '0', '-0.00', '12oops', '1e3', 'Infinity', 'NaN', '1.234', '1,000', '9007199254740992']) {
    app.run(`new_amount = ${JSON.stringify(value)}`);
    await app.run('add_transaction()');
    assert.match(app.run('form_error'), /non-zero amount/);
  }
  assert.equal(writes.length, 0);
  app.run('new_amount = "-.29"');
  await app.run('add_transaction()');
  assert.equal(writes[0].amount, -0.29);
  assert.equal(writes[0].text, 'Coffee');
  assert.equal(app.run('new_amount'), '');
});

test('Expenses totals use cents even for string amounts and ignore non-finite legacy values', () => {
  const app = harness('expense', { subscribe(callback) {
    callback([
      { id: '1', amount: 0.1 }, { id: '2', amount: '0.20' },
      { id: '3', amount: -0.1 }, { id: '4', amount: '-0.20' }, { id: '5', amount: 'oops' }
    ]);
    return () => {};
  } });
  assert.equal(app.run('income()'), 0.3);
  assert.equal(app.run('expense()'), 0.3);
  assert.equal(app.run('balance()'), 0);
});

test('Expenses prevents duplicate submits and preserves entries after save failure', async () => {
  let reject;
  let calls = 0;
  const app = harness('expense', { subscribe(callback) { callback([]); return () => {}; }, create: () => { calls++; return new Promise((_, fail) => { reject = fail; }); } });
  app.run('new_text = " Train ticket "; new_amount = "-12.50"');
  const pending = app.run('add_transaction()');
  await app.run('add_transaction()');
  assert.equal(calls, 1);
  reject(new Error('Offline'));
  await pending;
  assert.equal(app.run('new_text'), ' Train ticket ');
  assert.equal(app.run('new_amount'), '-12.50');
  assert.equal(app.run('saving'), false);
  assert.match(app.run('form_error'), /could not be saved/);
});

test('Expenses restores an optimistically removed transaction after deletion fails and cleans up', async () => {
  let notify;
  let unsubscribed = false;
  const app = harness('expense', {
    subscribe(callback) { notify = callback; callback([{ id: '1', text: 'Rent', amount: -100, created: '2026-10-21' }]); return () => { unsubscribed = true; }; },
    async delete() { notify([]); throw new Error('Offline'); }
  });
  await app.run('delete_transaction("1")');
  assert.equal(app.run('transactions.length'), 1);
  assert.equal(app.run('transactions[0].text'), 'Rent');
  assert.match(app.run('history_error'), /could not be deleted/);
  assert.equal(app.run('deleting_id'), null);
  app.cleanup.forEach(callback => callback());
  assert.equal(unsubscribed, true);
});

test('Expenses exports complete dates, quoted descriptions and spreadsheet-safe text', () => {
  const app = harness('expense', { subscribe(callback) {
    callback([{ id: '1', text: 'Lunch, "team"\nWednesday', amount: -12.5, created: '2026-10-21T12:00:00Z' }, { id: '2', text: '=1+1', amount: 1, created: 'invalid' }]);
    return () => {};
  } });
  const csv = app.run('export_csv()');
  assert.match(csv, /2026-10-21/);
  assert.match(csv, /"Lunch, ""team""\nWednesday",-12\.50/);
  assert.match(csv, /"'=1\+1",1\.00/);
  assert.equal(app.run('format_date("invalid")'), '');
  assert.equal(template('expense').data.transactions.records.length, 0);
  assert.ok(template('expense').preview_records.transactions.length > 0);
});

for (const name of ['timer', 'expense']) {
  test(`${name}: initial load failure leaves loading state and retries without losing input or save errors`, async () => {
    let fail = true;
    let calls = 0;
    const app = harness(name, {
      subscribe(_callback, _params, onError) { onError(new Error('Offline')); return () => {}; },
      async list() { calls++; if (fail) throw new Error('Still offline'); return [{ id: 'recovered', amount: 12, completed_at: '2026-10-21T11:00:00Z', created: '2026-10-21T11:00:00Z' }]; }
    });
    assert.equal(app.run('loading'), false);
    assert.match(app.run('load_error'), /could not be loaded/);
    app.run(name === 'timer' ? 'task_name = "Unfinished task"; save_error = "Pending session save"' : 'new_text = "Coffee"; new_amount = "-4.25"; form_error = "Pending entry save"');
    await app.run('retry_load()');
    assert.equal(app.run('retrying'), false);
    assert.match(app.run('load_error'), /could not be loaded/);
    fail = false;
    await app.run('retry_load()');
    assert.equal(calls, 2);
    assert.equal(app.run('load_error'), '');
    assert.equal(app.run(`${name === 'timer' ? 'sessions' : 'transactions'}[0].id`), 'recovered');
    if (name === 'timer') {
      assert.equal(app.run('task_name'), 'Unfinished task');
      assert.equal(app.run('save_error'), 'Pending session save');
    } else {
      assert.equal(app.run('new_text'), 'Coffee');
      assert.equal(app.run('new_amount'), '-4.25');
      assert.equal(app.run('form_error'), 'Pending entry save');
    }
  });

  test(`${name}: retry does not overwrite newer live data or mutate state after close`, async () => {
    let notify;
    let resolve;
    let calls = 0;
    const app = harness(name, {
      subscribe(callback, _params, onError) { notify = callback; onError(new Error('Offline')); return () => {}; },
      list() { calls++; return new Promise(done => { resolve = done; }); }
    });
    const pending = app.run('retry_load()');
    await app.run('retry_load()');
    assert.equal(calls, 1);
    notify([{ id: 'new-live-data' }]);
    resolve([{ id: 'stale-list-result' }]);
    await pending;
    const collection = name === 'timer' ? 'sessions' : 'transactions';
    assert.equal(app.run(`${collection}[0].id`), 'new-live-data');
    assert.equal(app.run('load_error'), '');
    const closing = app.run('retry_load()');
    app.cleanup.forEach(callback => callback());
    resolve([{ id: 'after-close' }]);
    await closing;
    notify([{ id: 'late-subscription' }]);
    assert.equal(app.run(`${collection}[0].id`), 'new-live-data');
  });
}
