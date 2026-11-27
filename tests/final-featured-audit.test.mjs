import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const groups = {
  'reading-list': ['books'], recipes: ['recipes'], 'goal-tracker': ['goals', 'milestones'],
  'client-crm': ['clients'], invoice: ['invoice', 'items'], 'time-tracker': ['entries', 'projects']
};
const template = id => JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function collection(records = [], overrides = {}) {
  let receive, onError;
  const calls = { subscribe: [], list: [] };
  return {
    calls,
    subscribe(callback, params, fail) { receive = callback; onError = fail; calls.subscribe.push(params); callback(records); return () => receive = null; },
    emit(rows) { records = rows; receive?.(rows); },
    fail() { onError?.(Error('Offline')); },
    list: async params => { calls.list.push(params); return records; },
    create: async fields => ({ id: 'created', ...fields }), update: async (id, fields) => ({ id, ...fields }), delete: async () => {},
    ...overrides
  };
}
function harness(id, collections, extras = {}) {
  const source = template(id);
  let script = source.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const nodes = parse(script, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  for (const node of nodes.reverse()) {
    if (node.type === 'ImportDeclaration') script = script.slice(0, node.start) + script.slice(node.end);
    else if (node.type === 'VariableDeclaration') {
      const declaration = node.declarations[0], init = declaration.init;
      let getter;
      if (init?.callee?.name === '$derived') getter = script.slice(init.arguments[0].start, init.arguments[0].end);
      if (init?.callee?.object?.name === '$derived') getter = `(${script.slice(init.arguments[0].start, init.arguments[0].end)})()`;
      if (getter) script = script.slice(0, node.start) + `Object.defineProperty(globalThis, ${JSON.stringify(declaration.id.name)}, { get: () => (${getter}) });` + script.slice(node.end);
    }
  }
  const cleanup = [], mounts = [], effects = [], timers = new Map();
  let nextTimer = 0;
  const location = { _hash: '', search: '', pathname: '/', get hash() { return this._hash; }, set hash(value) { this._hash = value.startsWith('#') ? value : '#' + value; } };
  const context = vm.createContext({ data: collections, content: Object.fromEntries(source.content.map(field => [field.id, field.value])),
    $state: value => value, $effect: fn => effects.push(fn), onDestroy: fn => cleanup.push(fn), onMount: fn => mounts.push(fn),
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => timers.delete(id),
    URL, URLSearchParams, window: { location, history: { replaceState() {} }, print() {}, addEventListener() {}, removeEventListener() {} },
    confirm: () => true, asset: value => value, console, ...extras });
  vm.runInContext(script, context);
  return { run: code => vm.runInContext(code, context), cleanup, mounts, effects, timers };
}

for (const [id, names] of Object.entries(groups)) {
  test(`${id}: collections request all records on initial loads and retries`, async () => {
    const collections = Object.fromEntries(names.map(name => [name, collection()]));
    const app = harness(id, collections);
    for (const name of names) assert.equal(collections[name].calls.subscribe[0].all, true);
    await app.run('retry_load()');
    for (const name of names) assert.equal(collections[name].calls.list[0].all, true);
    app.cleanup.forEach(fn => fn());
  });
  test(`${id}: late retries and errors cannot repopulate a closed app`, async () => {
    const pending = deferred();
    const collections = Object.fromEntries(names.map(name => [name, collection([{ id: 'existing', title: 'Existing' }], { list: () => pending.promise })]));
    const app = harness(id, collections);
    const retry = app.run('retry_load()');
    const errors = id === 'goal-tracker' ? 'load_errors.join()' : 'load_error';
    const previousError = app.run(errors);
    app.cleanup.forEach(fn => fn());
    Object.values(collections).forEach(value => value.fail());
    pending.resolve([{ id: 'late', title: 'Late' }]); await retry;
    const checks = id === 'invoice' ? ['invoice_record_id', 'items[0].id'] : names.map(name => `${name}[0].id`);
    for (const check of checks) assert.equal(app.run(check), 'existing');
    assert.equal(app.run(errors), previousError);
  });
  test(`${id}: compiles without warnings and every editable field still has a role`, () => {
    const source = template(id);
    for (const generate of ['client', 'server']) assert.deepEqual(compile(source.frontend_code, { filename: `${id}.svelte`, generate }).warnings, []);
    for (const field of source.content) assert.ok(source.frontend_code.includes(`content.${field.id}`), `Unused content field ${field.id}`);
    for (const field of source.design) assert.ok(source.frontend_code.includes(field.css_var), `Unused design field ${field.id}`);
  });
}

test('Recipes: an edit deep link recovers after its first load failed before mount', async () => {
  const app = harness('recipes', { recipes: collection([], {
    subscribe(_rows, _params, fail) { fail(Error('Offline')); return () => {}; },
    list: async () => [{ id: 'recipe', title: 'Recovered recipe', servings: 2 }]
  }) });
  app.run('window.location.hash = "/edit/recipe"'); app.mounts[0]();
  assert.equal(app.run('view'), 'missing');
  await app.run('retry_load()');
  assert.equal(app.run('view'), 'form');
  assert.equal(app.run('form.title'), 'Recovered recipe');
  app.run('form.title = "My draft"');
  app.run('receive_recipes([{id:"recipe",title:"Later server value"}])');
  assert.equal(app.run('form.title'), 'My draft');
});

test('Reading list: absent optional cover values remain harmless', () => {
  const app = harness('reading-list', { books: collection() });
  assert.equal(app.run('http_url(null)'), '');
  assert.equal(app.run('http_url(undefined)'), '');
  assert.equal(app.run('http_url(" javascript:alert(1) ")'), null);
});

test('Goals: a completed milestone save cannot close a newer goal milestone form', async () => {
  const pending = deferred();
  const app = harness('goal-tracker', { goals: collection([{ id: 'first', target: 10 }, { id: 'second', target: 20 }]), milestones: collection([], { create: () => pending.promise }) });
  app.run('start_milestone("first"); milestone_name = "First milestone"; milestone_target = 5');
  const save = app.run('save_milestone(null, goals[0])');
  app.run('start_milestone("second"); milestone_name = "Second draft"; milestone_target = 12');
  pending.resolve(); await save;
  assert.equal(app.run('milestone_goal'), 'second');
  assert.equal(app.run('milestone_name'), 'Second draft');
  assert.equal(app.run('milestone_target'), 12);
});

test('Goals: milestones cannot be created against invalid legacy goal targets', async () => {
  let writes = 0;
  const app = harness('goal-tracker', { goals: collection(), milestones: collection([], { create: async () => { writes += 1; } }) });
  app.run('milestone_name = "Halfway"; milestone_target = 5');
  for (const target of ['NaN', 'Infinity', 'null', '0', '-2']) await app.run(`save_milestone(null, {id:"goal",target:${target}})`);
  assert.equal(writes, 0);
  assert.match(app.run('error'), /milestone target/);
});

test('Clients: a failed board status save resets the select to the restored record', async () => {
  const clients = collection([{ id: 'client', name: 'Ada', status: 'lead' }]);
  clients.update = async () => {
    clients.emit([{ id: 'client', name: 'Ada', status: 'active' }]);
    clients.emit([{ id: 'client', name: 'Ada', status: 'lead' }]);
    throw Error('Offline');
  };
  const app = harness('client-crm', { clients });
  app.run('globalThis.select = {value:"active"}');
  await app.run('select_status({currentTarget:select}, clients[0])');
  assert.equal(app.run('select.value'), 'lead');
  assert.match(app.run('error'), /Could not change/);
});

for (const [id, names] of Object.entries({ invoice: ['invoice', 'items'], 'time-tracker': ['entries', 'projects'] })) {
  test(`${id}: a load recovery clears only its own error and retries have one pending request`, async () => {
    const pending = deferred(); let requests = 0;
    const collections = Object.fromEntries(names.map(name => [name, collection([], { list: () => { requests += 1; return pending.promise; } })]));
    const app = harness(id, collections);
    collections[names[0]].fail(); collections[names[1]].fail();
    collections[names[0]].emit([]);
    assert.notEqual(app.run('load_error'), '');
    collections[names[1]].emit([]);
    assert.equal(app.run('load_error'), '');
    const first = app.run('retry_load()'); await app.run('retry_load()');
    assert.equal(requests, 2);
    pending.resolve([]); await first;
    assert.equal(app.run('retrying_load'), false);
  });
}

test('Invoice: clean remote header changes arrive, while an unsaved local draft survives refreshes', () => {
  const headers = collection([{ id: 'invoice', company_name: 'Original' }]);
  const app = harness('invoice', { invoice: headers, items: collection() });
  headers.emit([{ id: 'invoice', company_name: 'Remote change' }]);
  assert.equal(app.run('invoice.company_name'), 'Remote change');
  app.run('invoice.company_name = "My draft"; save_invoice()');
  headers.emit([{ id: 'invoice', company_name: 'Older remote value' }]);
  assert.equal(app.run('invoice.company_name'), 'My draft');
});

test('Invoice: print preparation guards duplicate clicks and checks edits made during a pending write', async () => {
  const pending = deferred(); let prints = 0, writes = 0;
  const app = harness('invoice', { invoice: collection([{ id: 'invoice' }], { update: () => { writes += 1; return pending.promise; } }), items: collection() }, { window: { print: () => prints += 1 } });
  const first = app.run('print_invoice()'); await app.run('print_invoice()');
  assert.equal(writes, 1);
  app.run('invoice.tax_rate = undefined; save_invoice()');
  pending.resolve(); await first;
  assert.equal(prints, 0);
  assert.match(app.run('validation_error'), /tax rate/);
  assert.equal(app.run('printing'), false);
});

test('Invoice: closing during print preparation prevents a late print dialog', async () => {
  const pending = deferred(); let prints = 0;
  const app = harness('invoice', { invoice: collection([{ id: 'invoice' }], { update: () => pending.promise }), items: collection() }, { window: { print: () => prints += 1 } });
  const printing = app.run('print_invoice()');
  app.cleanup.forEach(fn => fn());
  pending.resolve(); await printing;
  assert.equal(prints, 0);
});

test('Time tracker: metadata edits preserve explicitly non-billable empty values', async () => {
  const writes = [];
  const app = harness('time-tracker', { entries: collection([], { update: async (id, fields) => writes.push(fields) }), projects: collection() });
  for (const billable of ['null', '0', 'false']) {
    app.run(`open_edit_modal({id:"entry",date:"2026-10-21",start_time:"09:00",end_time:"10:00",duration:3600,billable:${billable}})`);
    app.run('form.description = "Metadata edit"'); await app.run('save_entry()');
  }
  assert.equal(writes.length, 3);
  for (const value of writes) assert.equal(value.billable, false);
});

test('Time tracker: unknown projects cannot start recording and impossible date labels remain clear', () => {
  const app = harness('time-tracker', { entries: collection(), projects: collection() });
  app.run('timer_project = "removed"; start_timer()');
  assert.equal(app.run('timer_running'), false);
  assert.match(app.run('timer_error'), /available project/);
  assert.equal(app.run('format_date_header("2026-02-30")'), 'Unknown date');
});
