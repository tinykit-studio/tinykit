import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {compile} from 'svelte/compiler';

const template = name => JSON.parse(readFileSync(new URL(`../src/lib/templates/${name}.json`, import.meta.url), 'utf8'));

function collection(initial = [], overrides = {}) {
  let rows = initial, callback;
  return {
    subscribe(receive) { callback = receive; receive(rows); return () => { callback = null; }; },
    list:async () => rows,
    emit(next) { rows = next; callback?.(rows); },
    create:async value => ({id:'created', ...value}), update:async () => {}, delete:async () => {},
    ...overrides
  };
}
function harness(name, collections, options = {}) {
  const source = template(name);
  let script = source.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(script, {ecmaVersion:'latest', sourceType:'module'}).body.filter(node => node.type === 'ImportDeclaration').reverse()) script = script.slice(0, node.start) + script.slice(node.end);
  let now = new Date(options.now || '2026-10-21T17:00:00Z').getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const cleanup = [], effects = [], timers = new Map();
  let nextTimer = 0;
  const derived = value => value;
  derived.by = callback => callback();
  const context = vm.createContext({
    data:collections, content:Object.fromEntries(source.content.map(field => [field.id, field.value])),
    Date:Clock, URLSearchParams, $state:value => value, $derived:derived, $effect:callback => effects.push(callback),
    onDestroy:callback => cleanup.push(callback), confirm:options.confirm || (() => true),
    setInterval:callback => {timers.set(++nextTimer, callback); return nextTimer;}, clearInterval:id => timers.delete(id),
    setTimeout:callback => {timers.set(++nextTimer, callback); return nextTimer;}, clearTimeout:id => timers.delete(id),
    ...(options.window ? {window:options.window} : {})
  });
  vm.runInContext(script, context);
  return {run:source => vm.runInContext(source, context), cleanup, effects, timers, advance:milliseconds => {now += milliseconds;}, tick:() => [...timers.values()].forEach(callback => callback())};
}
const goalsApp = (goals = collection(), milestones = collection(), options) => harness('goal-tracker', {goals, milestones}, options);
const clientsApp = (clients = collection(), options) => harness('client-crm', {clients}, options);

for (const name of ['goal-tracker', 'client-crm']) test(`${name}: compiles without warnings and keeps gallery examples out of installed data`, () => {
  const source = template(name);
  for (const generate of ['client', 'server']) assert.deepEqual(compile(source.frontend_code, {filename:name + '.svelte', generate}).warnings, []);
  for (const data of Object.values(source.data)) assert.equal(data.records.length, 0);
  assert.ok(Object.values(source.preview_records).some(records => records.length > 0));
  assert.match(source.frontend_code, /<dialog bind:this=\{dialog\}/);
});

test('Goals: rejects blank names, invalid numbers and impossible dates without losing failed edits', async () => {
  let writes = 0;
  const app = goalsApp(collection([], {create:async () => {writes++; throw new Error('Offline');}}));
  app.run('start_add(); form_name="  ";');
  await app.run('save_goal()');
  assert.match(app.run('error'), /name/);
  app.run('form_name="Read"; form_target=0;');
  await app.run('save_goal()');
  assert.match(app.run('error'), /target/);
  app.run('form_target=24; form_current=Infinity;');
  await app.run('save_goal()');
  assert.match(app.run('error'), /current/);
  app.run('form_current=0; form_deadline="2026-02-30";');
  await app.run('save_goal()');
  assert.match(app.run('error'), /valid deadline/);
  assert.equal(writes, 0);
  app.run('form_deadline="2026-12-31";');
  await app.run('save_goal()');
  assert.equal(writes, 1);
  assert.equal(app.run('form_name'), 'Read');
  assert.equal(app.run('show_form'), true);
  assert.equal(app.run('saving'), false);
  assert.match(app.run('error'), /still here/);
});

test('Goals: blocks double saves, trims input and appends after the largest order', async () => {
  const writes = [];
  let finish;
  const rows = [{id:'high', order:9}, {id:'low', order:2}];
  const app = goalsApp(collection(rows, {create:value => {writes.push(value); return new Promise(resolve => {finish = resolve;});}}));
  assert.equal(rows[0].id, 'high', 'subscription sorting does not mutate received rows');
  app.run('start_add(); form_name="  Read 24 books "; form_target=24; form_unit=" books ";');
  const pending = app.run('save_goal()');
  await app.run('save_goal()');
  app.run('cancel_form()');
  assert.equal(app.run('show_form'), true, 'pending saves cannot silently close the editor');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'Read 24 books');
  assert.equal(writes[0].unit, 'books');
  assert.equal(writes[0].order, 10);
  finish({id:'new'}); await pending;
  assert.equal(app.run('show_form'), false);
});

test('Goals: numeric progress updates use the latest value, reject duplicate clicks and recover from failure', async () => {
  const writes = [];
  let finish, fail = false;
  const records = collection([{id:'g1',name:'Books',target:24,current:'18'}], {update:(id, fields) => {writes.push({id,fields}); return fail ? Promise.reject(new Error('Offline')) : new Promise(resolve => {finish = resolve;});}});
  const app = goalsApp(records);
  const pending = app.run('update_progress({id:"g1",current:2,target:24},1)');
  await app.run('update_progress({id:"g1",current:2,target:24},1)');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields.current, 19);
  finish(); await pending;
  fail = true;
  await app.run('update_progress(goals[0],-1)');
  assert.match(app.run('error'), /Could not update/);
  assert.equal(app.run('pending_ids.length'), 0);
  assert.equal(app.run('get_progress({target:0,current:20})'), 0);
  assert.equal(app.run('get_progress({target:24,current:-2})'), 0);
  assert.equal(app.run('get_progress({target:24,current:30})'), 100);
  assert.equal(app.run('marker_position({target:10},{target:15})'), 100);
});

test('Goals: local deadline days survive timezone offsets and daylight-saving boundaries', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const app = goalsApp(collection(), collection(), {now:'2026-10-21T23:30:00-05:00'});
    assert.equal(app.run('days_remaining("2026-10-21")'), 0);
    assert.equal(app.run('get_status({target:10,current:1,deadline:"2026-10-21",created_at:"2026-10-20T10:00:00-05:00"})') === 'overdue', false);
    assert.equal(app.run('get_status({target:10,current:1,deadline:"2026-10-20"})'), 'overdue');
    assert.equal(app.run('format_date("2026-10-21")'), 'Oct 21, 2026');
    assert.equal(app.run('days_remaining("2026-02-30")'), null);
    app.advance(3600000); app.tick();
    assert.equal(app.run('days_remaining("2026-10-21")'), -1);
    const dst = goalsApp(collection(), collection(), {now:'2026-11-01T00:30:00-05:00'});
    assert.equal(dst.run('days_remaining("2026-11-02")'), 1);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Goals: usable milestones validate targets, retain failed input and remove child records before deleting a goal', async () => {
  const actions = [];
  let fail = true;
  const app = goalsApp(collection([{id:'g1',target:10,current:3}], {delete:async id => actions.push(['goal',id])}), collection([{id:'m1',goal_id:'g1',target:5}], {
    create:async fields => {if (fail) throw new Error('Offline'); actions.push(['create',fields]);},
    delete:async id => actions.push(['milestone',id])
  }));
  app.run('start_milestone("g1"); milestone_name="Halfway"; milestone_target=12;');
  await app.run('save_milestone(null, goals[0])');
  assert.match(app.run('error'), /milestone target/);
  app.run('milestone_target=5;');
  await app.run('save_milestone(null, goals[0])');
  assert.equal(app.run('milestone_goal'), 'g1');
  assert.equal(app.run('milestone_name'), 'Halfway');
  assert.equal(app.run('pending_ids.length'), 0);
  fail = false;
  await app.run('save_milestone(null, goals[0])');
  assert.equal(actions[0][1].goal_id, 'g1');
  assert.equal(actions[0][1].completed, false);
  assert.equal(app.run('milestone_goal'), null);
  await app.run('delete_goal("g1")');
  assert.deepEqual(actions.slice(1), [['milestone','m1'], ['goal','g1']]);
});

test('Goals: failed milestone cleanup keeps the goal available to retry deletion', async () => {
  let goal_deletes = 0;
  const app = goalsApp(collection([{id:'g1',target:10,current:3}], {delete:async () => {goal_deletes++;}}), collection([{id:'m1',goal_id:'g1'}], {delete:async () => {throw new Error('Offline');}}));
  await app.run('delete_goal("g1")');
  assert.equal(goal_deletes, 0);
  assert.match(app.run('error'), /finish deleting/);
  assert.equal(app.run('pending_ids.length'), 0);
});

test('Goals: both collections can fail visibly, retry and unsubscribe cleanly', async () => {
  let released = 0;
  const failed = records => collection(records, {subscribe(_rows, _params, onError) {onError(new Error('Offline')); return () => {released++;};}});
  const app = goalsApp(failed([{id:'g1',target:5,current:0}]), failed([]));
  assert.equal(app.run('load_errors.length'), 2);
  assert.equal(app.run('loading'), false);
  await app.run('retry_load()');
  assert.equal(app.run('load_errors.length'), 0);
  assert.equal(app.run('goals.length'), 1);
  app.cleanup.forEach(callback => callback());
  assert.equal(released, 2);
  assert.equal(app.timers.size, 0);
});

test('Clients: validates fields, permits a name-only contact and retains failed edits', async () => {
  const writes = [];
  let fail = true;
  const app = clientsApp(collection([], {create:async fields => {if (fail) throw new Error('Offline'); writes.push(fields);}}));
  app.run('open_add_modal(); form.name="  ";');
  await app.run('save_client()');
  assert.match(app.run('error'), /name/);
  app.run('form.name="  Ada "; form.email="broken";');
  await app.run('save_client()');
  assert.match(app.run('error'), /email/);
  app.run('form.email=""; form.value=-1;');
  await app.run('save_client()');
  assert.match(app.run('error'), /value/);
  app.run('form.value=undefined; form.next_follow_up="2026-02-30";');
  await app.run('save_client()');
  assert.match(app.run('error'), /valid contact/);
  app.run('form.next_follow_up=""; form.last_contact="2026-10-22";');
  await app.run('save_client()');
  assert.match(app.run('error'), /future/);
  app.run('form.last_contact="";');
  await app.run('save_client()');
  assert.match(app.run('error'), /still here/);
  assert.equal(app.run('modal_open'), true);
  assert.equal(app.run('form.name'), '  Ada ');
  assert.equal(app.run('saving'), false);
  fail = false;
  await app.run('save_client()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'Ada');
  assert.equal(writes[0].value, null);
  assert.equal(writes[0].last_contact, '', 'adding a client does not invent a contact event');
  assert.equal(app.run('modal_open'), false);
});

test('Clients: save is a single guarded submission and entered cents are preserved', async () => {
  let finish;
  const writes = [];
  const app = clientsApp(collection([], {create:fields => {writes.push(fields); return new Promise(resolve => {finish = resolve;});}}));
  app.run('open_add_modal(); form.name="Ada"; form.email=" ada@example.com "; form.value="12.34";');
  const pending = app.run('save_client()');
  await app.run('save_client()');
  app.run('close_modal()');
  assert.equal(app.run('modal_open'), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].email, 'ada@example.com');
  assert.equal(writes[0].value, 12.34);
  finish({id:'new'}); await pending;
  assert.equal(app.run('modal_open'), false);
});

test('Clients: search trims queries and tolerates absent legacy fields; totals use numbers and omit closed work', () => {
  const app = clientsApp(collection([
    {id:'a',name:'Ada',phone:'555-0101',status:'lead',value:'12.34'},
    {id:'b',name:null,email:null,company:null,status:'active',value:'0.11'},
    {id:'c',name:'Old client',status:'churned',value:1000},
    {id:'d',name:'Inactive client',status:'inactive',value:1000}
  ]));
  assert.equal(app.run('get_stats().pipeline'), 12.45);
  app.run('search="  555-0101  ";');
  assert.equal(app.run('get_filtered_clients().length'), 1);
  app.run('search="  ada  ";');
  assert.equal(app.run('get_filtered_clients()[0].id'), 'a');
  assert.equal(app.run('has_value(undefined)'), false);
  assert.equal(app.run('has_value(null)'), false);
  assert.equal(app.run('has_value(0)'), true);
  assert.equal(app.run('format_currency("12345.67")'), '$12,345.67');
  assert.equal(app.run('format_currency(Infinity)'), '$0');
});

test('Clients: contact and follow-up dates use the local day across timezones', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    const writes = [];
    const app = clientsApp(collection([{id:'c1',name:'Ada',next_follow_up:'2026-10-21'}], {update:async (id,fields) => writes.push({id,fields})}), {now:'2026-10-21T00:30:00+09:00'});
    assert.equal(app.run('is_overdue("2026-10-21")'), false);
    assert.equal(app.run('is_due("2026-10-21")'), true);
    assert.equal(app.run('format_relative_date("2026-10-21")'), 'Today');
    assert.equal(app.run('format_relative_date("2026-10-22")'), 'Tomorrow');
    assert.equal(app.run('format_relative_date("2026-10-20")'), 'Yesterday');
    await app.run('log_contact(clients[0])');
    assert.equal(writes[0].fields.last_contact, '2026-10-21');
    assert.equal(writes[0].fields.next_follow_up, '');
    assert.equal(app.run('contacted_today("2026-10-21")'), true);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Clients: contact logging only reports success after saving and duplicate clicks cannot write twice', async () => {
  let writes = 0, finish;
  const app = clientsApp(collection([{id:'c1',name:'Ada'}], {update:() => {writes++; return new Promise((resolve,reject) => {finish = reject;});}}));
  const pending = app.run('log_contact(clients[0])');
  await app.run('log_contact(clients[0])');
  assert.equal(writes, 1);
  assert.equal(app.run('just_logged'), null);
  finish(new Error('Offline')); await pending;
  assert.equal(app.run('just_logged'), null);
  assert.match(app.run('error'), /Could not log/);
  assert.equal(app.run('pending_ids.length'), 0);
});

test('Clients: touch and drag status updates validate destinations and clear failed drag state', async () => {
  const writes = [];
  const app = clientsApp(collection([{id:'c1',name:'Ada',status:'lead'}], {update:async (id,fields) => {writes.push({id,fields}); if(fields.status === 'churned') throw new Error('Offline');}}));
  await app.run('change_status("c1","active")');
  await app.run('change_status("c1","invalid")');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields.status, 'active');
  app.run('dragging_id="c1"; drag_over_status="churned";');
  await app.run('handle_drop({preventDefault(){}},"churned")');
  assert.equal(app.run('dragging_id'), null);
  assert.equal(app.run('drag_over_status'), null);
  assert.equal(app.run('pending_ids.length'), 0);
  assert.match(app.run('error'), /Could not change/);
});

test('Clients: failed deletion keeps the editor open, loads retry, and cleanup clears timers and subscription', async () => {
  let released = false;
  const app = clientsApp(collection([{id:'c1',name:'Ada'}], {
    subscribe(_rows, _params, onError) {onError(new Error('Offline')); return () => {released = true;};},
    delete:async () => {throw new Error('Offline');}
  }));
  assert.equal(app.run('load_error'), 'Could not load clients.');
  await app.run('retry_load()');
  assert.equal(app.run('load_error'), '');
  assert.equal(app.run('clients.length'), 1);
  app.run('open_edit_modal(clients[0])');
  await app.run('delete_client("c1")');
  assert.equal(app.run('modal_open'), true);
  assert.equal(app.run('saving'), false);
  assert.match(app.run('error'), /Could not delete/);
  await app.run('log_contact(clients[0])');
  assert.equal(app.timers.size, 2);
  app.cleanup.forEach(callback => callback());
  assert.equal(released, true);
  assert.equal(app.timers.size, 0);
});

test('Clients: view URLs keep fragments and a restricted preview history cannot crash the app', () => {
  const writes = [];
  const app = clientsApp(collection(), {window:{location:{search:'?view=table&other=1',pathname:'/clients',hash:'#follow-up'},history:{replaceState:(_a,_b,url) => writes.push(url)}}});
  assert.equal(app.run('view'), 'table');
  app.effects.forEach(callback => callback());
  assert.equal(writes[0], '/clients?view=table&other=1#follow-up');
  const restricted = clientsApp(collection(), {window:{location:{search:'?view=kanban',pathname:'about:srcdoc',hash:''},history:{replaceState:() => {throw new Error('SecurityError');}}}});
  assert.doesNotThrow(() => restricted.effects.forEach(callback => callback()));
});

test('Goals: deleting waits for milestone data so a failed load cannot leave unknown orphan records', async () => {
  let writes = 0;
  const app = goalsApp(collection([{id:'g1',name:'Read'}], {delete:async () => {writes++;}}), collection([], {subscribe(_rows,_params,onError) {onError(new Error('Offline')); return () => {};}}));
  await app.run('delete_goal("g1")');
  assert.equal(writes, 0);
  assert.match(app.run('error'), /Load milestones/);
});

test('Clients: an in-flight contact save cannot create a timer after the app is closed', async () => {
  let finish;
  const app = clientsApp(collection([{id:'c1',name:'Ada'}], {update:() => new Promise(resolve => {finish = resolve;})}));
  const pending = app.run('log_contact(clients[0])');
  app.cleanup.forEach(callback => callback());
  finish(); await pending;
  assert.equal(app.timers.size, 0);
  assert.equal(app.run('just_logged'), null);
});
