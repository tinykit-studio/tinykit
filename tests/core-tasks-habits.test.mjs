import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {compile} from 'svelte/compiler';

function template(name) {
  return JSON.parse(readFileSync(new URL(`../src/lib/templates/${name}.json`, import.meta.url), 'utf8'));
}
function harness(name, collections, {now = '2026-10-21T10:00:00+09:00'} = {}) {
  const source = template(name);
  let script = source.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const imports = parse(script, {ecmaVersion:'latest', sourceType:'module'}).body.filter(node => node.type === 'ImportDeclaration');
  for (const node of imports.reverse()) script = script.slice(0, node.start) + script.slice(node.end);
  const cleanup = [], mounts = [], timers = new Map();
  let timerId = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const context = vm.createContext({
    data:collections, content:Object.fromEntries(source.content.map(field => [field.id, field.value])),
    Date: Clock, $state:value => value, $derived:{by:fn => fn()}, $effect:() => {},
    onMount: callback => mounts.push(callback), onDestroy:callback => cleanup.push(callback),
    tick:() => Promise.resolve(),
    setTimeout:callback => {timers.set(++timerId, callback); return timerId;}, clearTimeout:id => timers.delete(id),
    setInterval:callback => {timers.set(++timerId, callback); return timerId;}, clearInterval:id => timers.delete(id)
  });
  vm.runInContext(script, context);
  return {run:source => vm.runInContext(source, context), timers, cleanup, mounts};
}
function collection(records = [], operations = {}) {
  let callback;
  return {
    subscribe(fn) { callback = fn; fn(records); return () => {callback = null;}; },
    list:async () => records,
    emit(items) {records = items; callback?.(records);},
    create: async value => ({id:'created', ...value}), update: async () => {}, delete: async () => {},
    ...operations
  };
}

for (const name of ['kanban','habits']) test(`${name}: compiles without warnings and preserves clean installed records`, () => {
  const source = template(name);
  for (const generate of ['client','server']) {
    const result = compile(source.frontend_code, {filename:name + '.svelte', generate});
    assert.deepEqual(result.warnings.map(warning => warning.message), []);
  }
  assert.equal(source.data[name === 'kanban' ? 'cards' : 'completions'].records.length, 0);
});

test('Tasks: validates titles and dates, retains a failed edit, and releases subscriptions', async () => {
  let writes = 0, unsubscribed = false;
  const tasks = collection([], {
    subscribe(callback) {callback([]); return () => {unsubscribed = true;};},
    create:async () => {writes++; throw new Error('Offline');}
  });
  const app = harness('kanban', {cards:tasks});
  app.run('start_adding("todo"); form_title="   ";');
  await app.run('save_card("todo")');
  assert.equal(writes, 0);
  assert.match(app.run('error'), /title/);
  app.run('form_title="Prepare report"; form_due_date="2026-02-30";');
  await app.run('save_card("todo")');
  assert.equal(writes, 0);
  assert.match(app.run('error'), /valid due date/);
  app.run('form_due_date="2026-10-21";');
  await app.run('save_card("todo")');
  assert.equal(writes, 1);
  assert.equal(app.run('form_title'), 'Prepare report');
  assert.equal(app.run('adding_to_column'), 'todo');
  assert.equal(app.run('saving'), false);
  assert.match(app.run('error'), /Could not save/);
  app.cleanup.forEach(callback => callback());
  assert.equal(unsubscribed, true);
  assert.equal(app.timers.size, 0);
});

test('Tasks: a double submit creates once and appends after the highest existing order', async () => {
  let finish;
  const writes = [];
  const app = harness('kanban', {cards:collection([{id:'old',column:'todo',order:9}], {
    create:record => {writes.push(record); return new Promise(resolve => {finish = resolve;});}
  })});
  app.run('start_adding("todo"); form_title="  New task  ";');
  const pending = app.run('save_card("todo")');
  await app.run('save_card("todo")');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].title, 'New task');
  assert.equal(writes[0].order, 10);
  finish({id:'new'});
  await pending;
  assert.equal(app.run('adding_to_column'), null);
});

test('Tasks: keyboard/touch moves and drag moves share ordering, and a failed drop clears drag state', async () => {
  const writes = [];
  const app = harness('kanban', {cards:collection([
    {id:'move',column:'todo',order:0}, {id:'destination',column:'progress',order:5}
  ], {update:async (id,fields) => {writes.push({id,fields}); if (fields.column === 'done') throw new Error('Offline');}})});
  await app.run('move_card("move", "progress")');
  assert.equal(writes[0].id, 'move');
  assert.equal(writes[0].fields.column, 'progress');
  assert.equal(writes[0].fields.order, 6);
  app.run('dragging_id="move"; drag_over_column="done";');
  await app.run('handle_drop({preventDefault() {}}, "done")');
  assert.equal(app.run('dragging_id'), null);
  assert.equal(app.run('drag_over_column'), null);
  assert.equal(app.run('pending_ids.length'), 0);
  assert.match(app.run('error'), /Could not move/);
  assert.match(template('kanban').frontend_code, /aria-label=\{`Move \$\{card.title\} to column`\}/);
});

test('Tasks: date-only deadlines use the local calendar without UTC shifts', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const app = harness('kanban', {cards:collection()}, {now:'2026-10-21T10:00:00-05:00'});
    assert.equal(app.run('format_date("2026-10-21")'), 'Today');
    assert.equal(app.run('format_date("2026-10-22")'), 'Tomorrow');
    assert.equal(app.run('is_overdue("2026-10-21")'), false);
    assert.equal(app.run('is_overdue("2026-10-20")'), true);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Habits: local date keys preserve the selected day east of UTC', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    const writes = [];
    const app = harness('habits', {habits:collection([{id:'h1',name:'Read'}]), completions:collection([], {create:async fields => {writes.push(fields); return {id:'completion', ...fields};}})});
    assert.equal(app.run('date_key(today)'), '2026-10-21');
    await app.run('toggle_completion("h1", today)');
    assert.equal(writes[0].date, '2026-10-21');
    assert.equal(app.run('is_completed("h1", today)'), true);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Habits: rapid checks create once; unchecking removes every duplicate completion', async () => {
  let finish;
  const writes = [], deleted = [];
  const completions = collection([], {create:fields => {writes.push(fields); return new Promise(resolve => {finish = resolve;});}, delete:async id => {deleted.push(id);}});
  const app = harness('habits', {habits:collection([{id:'h1',name:'Read'}]), completions});
  const pending = app.run('toggle_completion("h1", today)');
  await app.run('toggle_completion("h1", today)');
  assert.equal(writes.length, 1);
  finish({id:'first', ...writes[0]}); await pending;
  completions.emit([{id:'first', ...writes[0]}, {id:'duplicate', ...writes[0]}]);
  await app.run('toggle_completion("h1", today)');
  assert.deepEqual(deleted, ['first','duplicate']);
  assert.equal(app.run('is_completed("h1", today)'), false);
});

test('Habits: streaks bridge yesterday, ignore duplicate rows, and stop at missed days', () => {
  const app = harness('habits', {habits:collection([{id:'h1',name:'Read'}]), completions:collection()});
  app.run('completions = [1,2,2,3,5].map((days, i) => {const date = new Date(today); date.setDate(date.getDate() - days); return {id:String(i), habit_id:"h1", date:date_key(date)}})');
  assert.equal(app.run('get_streak("h1")'), 3);
  assert.equal(app.run('get_completion_rate("h1")'), 57);
  app.run('completions = completions.filter(c => c.date !== date_key(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)))');
  assert.equal(app.run('get_streak("h1")'), 0);
});

test('Habits: failed writes keep form data; archive offers undo; all subscriptions and midnight timers clean up', async () => {
  let unsubscribed = 0;
  const writes = [];
  const habits = collection([{id:'h1',name:'Read'}], {
    subscribe(callback) {callback([{id:'h1',name:'Read'}]); return () => {unsubscribed++;};},
    create:async () => {throw new Error('Offline');},
    update:async (id,fields) => {writes.push({id,fields});}
  });
  const app = harness('habits', {habits, completions:collection([], {subscribe(callback) {callback([]); return () => {unsubscribed++;};}})});
  const mountedCleanup = app.mounts.map(callback => callback());
  app.run('new_name="  Walk  "; show_form=true;');
  await app.run('add_habit({preventDefault() {}})');
  assert.equal(app.run('new_name'), '  Walk  ');
  assert.equal(app.run('show_form'), true);
  assert.equal(app.run('adding'), false);
  assert.match(app.run('error'), /Could not add/);
  await app.run('archive_habit(habits[0])');
  assert.equal(app.run('archived_habit.id'), 'h1');
  await app.run('undo_archive()');
  assert.equal(writes[0].fields.archived, true);
  assert.equal(writes[1].fields.archived, false);
  assert.equal(app.run('archived_habit'), null);
  [...app.cleanup, ...mountedCleanup].forEach(callback => callback());
  assert.equal(unsubscribed, 2);
  assert.equal(app.timers.size, 0);
});

test('Habits: the visible week retains seven distinct local days across daylight saving changes', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const app = harness('habits', {habits:collection(), completions:collection()}, {now:'2026-11-03T10:00:00-05:00'});
    assert.deepEqual(Array.from(app.run('get_dates("week").map(date_key)')), ['2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-11-03']);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Tasks: a missing initial subscription response times out and failed loading can be retried', async () => {
  let fail = true;
  const app = harness('kanban', {cards:collection([], {
    subscribe() {return () => {};},
    list:async () => {if (fail) throw new Error('Offline'); return [{id:'recovered',column:'todo'}];}
  })});
  app.timers.values().next().value();
  assert.equal(app.run('load_error'), true);
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), true);
  assert.equal(app.run('loading'), false);
  fail = false;
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), false);
  assert.equal(app.run('cards[0].id'), 'recovered');
});

test('Habits: waits for both collections, exposes a load failure, and retries both together', async () => {
  let fail = true;
  const app = harness('habits', {
    habits:collection([{id:'h1',name:'Read'}]),
    completions:collection([], {subscribe() {return () => {};}, list:async () => {if (fail) throw new Error('Offline'); return [{id:'c1',habit_id:'h1',date:'2026-10-21'}];}})
  });
  assert.equal(app.run('habits_ready'), true);
  assert.equal(app.run('completions_ready'), false);
  app.timers.values().next().value();
  assert.equal(app.run('load_error'), true);
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), true);
  fail = false;
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), false);
  assert.equal(app.run('habits_ready && completions_ready'), true);
});

test('Habits: failed completion writes release the cell and future dates cannot be checked', async () => {
  let writes = 0;
  const app = harness('habits', {habits:collection([{id:'h1',name:'Read'}]), completions:collection([], {create:async () => {writes++; throw new Error('Offline');}})});
  await app.run('toggle_completion("h1", today)');
  assert.equal(writes, 1);
  assert.match(app.run('error'), /Could not update/);
  assert.equal(app.run('pending_cells.length'), 0);
  assert.equal(app.run('is_completed("h1", today)'), false);
  await app.run('toggle_completion("h1", new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))');
  assert.equal(writes, 1);
});

test('Tasks: subscription failures immediately expose Retry without waiting for the timeout', async () => {
  const app = harness('kanban', {cards:collection([], {
    subscribe(_callback, params, onError) {
      assert.equal(params.all, true);
      onError(new Error('Offline'));
      return () => {};
    },
    list:async () => [{id:'recovered', column:'todo'}]
  })});
  assert.equal(app.run('load_error'), true);
  assert.equal(app.run('loading'), false);
  assert.equal(app.timers.size, 0);
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), false);
  assert.equal(app.run('cards[0].id'), 'recovered');
});

for (const failed of ['habits','completions']) test(`Habits: a ${failed} subscription failure immediately exposes Retry`, async () => {
  const collections = {habits:collection([{id:'h1',name:'Read'}]), completions:collection()};
  collections[failed] = collection(failed === 'habits' ? [{id:'h1',name:'Read'}] : [], {
    subscribe(_callback, params, onError) {
      assert.equal(params.all, true);
      onError(new Error('Offline'));
      return () => {};
    }
  });
  const app = harness('habits', collections);
  assert.equal(app.run('load_error'), true);
  assert.equal(app.timers.size, 0);
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), false);
  assert.equal(app.run('habits_ready && completions_ready'), true);
});
