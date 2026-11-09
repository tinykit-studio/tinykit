import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const names = ['notes', 'bookmarks', 'kanban', 'habits', 'timer', 'expense'];
const templates = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(new URL(`../src/lib/templates/${name}.json`, import.meta.url), 'utf8'))]));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function collection(rows = [], operations = {}) {
  let receive;
  return {
    subscribe(callback, params) { assert.equal(params.all, true); receive = callback; callback(rows); return () => {}; },
    emit(rows) { receive(rows); },
    list: async params => { assert.equal(params.all, true); return rows; },
    update: async () => {}, create: async fields => ({ id: 'new-record', ...fields }), delete: async () => {}, ...operations
  };
}
function app(name, collections, extras = {}) {
  const template = templates[name];
  let source = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.reverse()) {
    if (node.type === 'ImportDeclaration') source = source.slice(0, node.start) + source.slice(node.end);
    else if (node.type === 'VariableDeclaration' && node.declarations[0].init?.callee?.object?.name === '$derived') {
      const declaration = node.declarations[0], fn = declaration.init.arguments[0];
      source = source.slice(0, node.start) + `Object.defineProperty(globalThis,${JSON.stringify(declaration.id.name)},{get:()=>(${source.slice(fn.start, fn.end)})()});` + source.slice(node.end);
    }
  }
  let clock = Date.parse('2026-10-21T12:00:00Z'), timerId = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const effects = [], cleanup = [], mounts = [], timers = new Map();
  const context = vm.createContext({
    data: collections, content: Object.fromEntries(template.content.map(field => [field.id, field.value])),
    $state: value => value, $effect: fn => effects.push(fn), onDestroy: fn => cleanup.push(fn), onMount: fn => mounts.push(fn), tick: () => Promise.resolve(),
    Date: Clock, window: {}, URL, console, crypto: { randomUUID: () => 'new-record' }, localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id), ...extras
  });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), effects, cleanup, mounts, timers, advance: milliseconds => { clock += milliseconds; } };
}

for (const name of names) test(`${name}: final template compiles for browser and server without warnings`, () => {
  for (const generate of ['client', 'server']) assert.deepEqual(compile(templates[name].frontend_code, { filename: `${name}.svelte`, generate }).warnings, []);
});

for (const [name, key] of [['notes', 'notes'], ['bookmarks', 'bookmarks'], ['kanban', 'cards']]) {
  test(`${name}: retry keeps newer live data, ignores duplicate clicks, and releases its state`, async () => {
    const request = deferred(); let calls = 0;
    const rows = collection([], { list: params => { assert.equal(params.all, true); calls++; return request.promise; } });
    const ui = app(name, { [key]: rows });
    const pending = ui.run('retry_load()'); await ui.run('retry_load()');
    assert.equal(calls, 1);
    rows.emit([{ id: 'live', title: 'Latest', order: 0 }]);
    request.resolve([{ id: 'stale', title: 'Stale', order: 0 }]); await pending;
    assert.equal(ui.run(`${key}[0].id`), 'live');
    assert.equal(ui.run(name === 'kanban' ? 'retrying' : 'retrying_load'), false);
  });
}

test('Notes refreshes remote content without replacing a pending local draft', () => {
  const rows = collection([{ id: 'note', title: 'Note', content: '<p>Original</p>' }]);
  let editor;
  class Editor {
    constructor(options) {
      editor = this; this.html = options.content;
      this.commands = { setContent: (html, options) => { assert.equal(options.emitUpdate, false); this.html = html; } };
    }
    getHTML() { return this.html; }
    destroy() {}
  }
  const ui = app('notes', { notes: rows }, { Editor, StarterKit: { configure: () => ({}) }, Underline: {}, Link: { configure: () => ({}) } });
  ui.run('editor_el = {}'); ui.effects[1]();
  rows.emit([{ id: 'note', title: 'Note', content: '<p>Changed elsewhere</p>' }]); ui.effects[1]();
  assert.equal(editor.html, '<p>Changed elsewhere</p>');
  ui.run('debounced_save("")');
  editor.html = '<p></p>';
  rows.emit([{ id: 'note', title: 'Note', content: '<p>Old server copy</p>' }]); ui.effects[1]();
  assert.equal(editor.html, '<p></p>');
});

test('Bookmarks appends after legacy string order and accepts null tags', async () => {
  const writes = [];
  const ui = app('bookmarks', { bookmarks: collection([{ id: 'legacy', title: 'Legacy', tags: null, order: '10' }], { create: async fields => { writes.push(fields); return fields; } }) });
  assert.equal(ui.run('all_tags.length'), 0);
  ui.run('new_url = "https://example.com"'); await ui.run('add_bookmark()');
  assert.equal(writes[0].order, 11);
});

test('Tasks ignores pending retry results and subscription callbacks after closing', async () => {
  const request = deferred(), rows = collection([{ id: 'loaded', column: 'todo' }], { list: () => request.promise });
  const ui = app('kanban', { cards: rows });
  const pending = ui.run('retry_load()'); ui.cleanup.forEach(fn => fn());
  request.resolve([{ id: 'late-retry' }]); await pending;
  rows.emit([{ id: 'late-live' }]);
  assert.equal(ui.run('cards[0].id'), 'loaded');
  assert.equal(ui.timers.size, 0);
});

test('Tasks accepts early calendar years and rejects year zero and normalized invalid dates', () => {
  const ui = app('kanban', { cards: collection() });
  assert.equal(ui.run('local_date_key(parse_due_date("0099-01-02"))'), '0099-01-02');
  assert.equal(ui.run('parse_due_date("0000-01-01")'), null);
  assert.equal(ui.run('parse_due_date("2026-02-30")'), null);
});

test('Habits preserves newer collection snapshots while recovering the other collection', async () => {
  const habitsRequest = deferred(), historyRequest = deferred();
  const habits = collection([{ id: 'old', name: 'Old' }], { list: params => { assert.equal(params.all, true); return habitsRequest.promise; } });
  const completions = collection([], { list: params => { assert.equal(params.all, true); return historyRequest.promise; } });
  const ui = app('habits', { habits, completions });
  const pending = ui.run('retry_load()'); await ui.run('retry_load()');
  habits.emit([{ id: 'new', name: 'New live habit' }]);
  habitsRequest.resolve([{ id: 'stale', name: 'Stale' }]); historyRequest.resolve([{ id: 'history', date: '2026-10-21' }]); await pending;
  assert.equal(ui.run('habits[0].id'), 'new');
  assert.equal(ui.run('completions[0].id'), 'history');
  assert.equal(ui.run('retrying'), false);
});

test('Habits keeps a newer archive Undo action when an older Undo finishes', async () => {
  const undo = deferred();
  const habits = collection([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { update: async (id, fields) => { if (id === 'a' && !fields.archived) await undo.promise; } });
  const ui = app('habits', { habits, completions: collection() });
  await ui.run('archive_habit(habits[0])');
  const pending = ui.run('undo_archive()');
  await ui.run('archive_habit(habits[1])');
  undo.resolve(); await pending;
  assert.equal(ui.run('archived_habit.id'), 'b');
});

test('Habits ignores retry results and subscriptions after closing', async () => {
  const request = deferred(), habits = collection([{ id: 'loaded', name: 'Loaded' }], { list: () => request.promise });
  const ui = app('habits', { habits, completions: collection() });
  const pending = ui.run('retry_load()'); ui.cleanup.forEach(fn => fn());
  request.resolve([{ id: 'late' }]); await pending; habits.emit([{ id: 'late-live' }]);
  assert.equal(ui.run('habits[0].id'), 'loaded');
  assert.equal(ui.timers.size, 0);
});

test('Focus timer refreshes idle history across midnight and cleans up its date clock', () => {
  const rows = collection([{ id: 'yesterday', type: 'work', duration: 1500, completed_at: '2026-10-21T12:00:00Z' }]);
  const ui = app('timer', { sessions: rows }, { document: {} });
  assert.equal(ui.run('today_sessions.length'), 1);
  ui.advance(24 * 60 * 60 * 1000);
  [...ui.timers.values()].forEach(fn => fn());
  assert.equal(ui.run('today_sessions.length'), 0);
  ui.cleanup.forEach(fn => fn()); assert.equal(ui.timers.size, 0);
});

test('Focus timer treats invalid legacy durations as zero', () => {
  const ui = app('timer', { sessions: collection() });
  assert.equal(ui.run('session_seconds(-10)'), 0);
  assert.equal(ui.run('session_seconds("Infinity")'), 0);
  assert.equal(ui.run('session_seconds("1500")'), 1500);
});

test('Expenses formats date-only legacy records on their original local calendar day', () => {
  const original = process.env.TZ; process.env.TZ = 'America/Chicago';
  try {
    const ui = app('expense', { transactions: collection() });
    assert.equal(ui.run('export_date("2026-10-21")'), '2026-10-21');
    assert.match(ui.run('format_date("2026-10-21")'), /Oct 21, 2026/);
    assert.equal(ui.run('format_date("2026-02-30")'), '');
    assert.equal(ui.run('transaction_date("0000-01-01")'), null);
    assert.equal(ui.run('amount_cents(1e307)'), 0);
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
