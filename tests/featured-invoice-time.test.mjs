import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {compile} from 'svelte/compiler';

const template = name => JSON.parse(readFileSync(new URL('../src/lib/templates/' + name + '.json', import.meta.url), 'utf8'));
function collection(records = [], operations = {}) {
  let callback, errorCallback;
  return {
    subscribe(fn, params, onError) { callback = fn; errorCallback = onError; fn(records); return () => { callback = null; }; },
    emit(rows) { records = rows; callback?.(rows); },
    fail() { errorCallback?.(new Error('Offline')); },
    list: async () => records,
    create: async fields => ({id:'created', ...fields}),
    update: async (id, fields) => ({id, ...fields}),
    delete: async () => {},
    ...operations
  };
}
function harness(name, collections, options = {}) {
  let script = template(name).frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(script, {ecmaVersion:'latest', sourceType:'module'}).body.filter(node => node.type === 'ImportDeclaration').reverse()) {
    script = script.slice(0, node.start) + script.slice(node.end);
  }
  let clock = Date.parse(options.now || '2026-10-21T12:00:00.000Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const cleanup = [], mounts = [], timers = new Map(), listeners = new Map();
  let nextTimer = 0;
  const state = value => value;
  const derived = value => value;
  derived.by = fn => fn();
  const context = vm.createContext({
    data: collections, content: Object.fromEntries(template(name).content.map(field => [field.id,field.value])),
    Date:Clock, $state:state, $derived:derived, $effect:() => {},
    onDestroy:fn => cleanup.push(fn), onMount:fn => mounts.push(fn),
    setTimeout:fn => { timers.set(++nextTimer,fn); return nextTimer; }, clearTimeout:id => timers.delete(id),
    setInterval:fn => { timers.set(++nextTimer,fn); return nextTimer; }, clearInterval:id => timers.delete(id),
    window:{print:options.print || (()=>{}), addEventListener:(event, fn) => listeners.set(event, fn), removeEventListener:event => listeners.delete(event)},
    confirm:() => true, console,
    ...options.globals
  });
  vm.runInContext(script, context);
  return {
    run:source => vm.runInContext(source,context),
    advance:milliseconds => { clock += milliseconds; },
    timers, cleanup, mounts, listeners,
    tick() { for (const callback of [...timers.values()]) callback(); }
  };
}
const flush = () => Promise.resolve().then(()=>Promise.resolve());

for (const name of ['invoice','time-tracker']) test(name + ': browser/publishing compile cleanly and installed collections start empty', () => {
  const source = template(name);
  for (const generate of ['client','server']) assert.deepEqual(compile(source.frontend_code,{filename:name + '.svelte',generate}).warnings,[]);
  assert.ok(Object.values(source.data).every(collection => collection.records.length === 0));
  assert.ok(Object.values(source.preview_records).some(rows => rows.length > 0));
});

test('Invoice: rounds each line and tax in cents, permits zero quantities, and rejects invalid or unsafe amounts', () => {
  const app = harness('invoice',{invoice:collection(),items:collection()});
  const totals = app.run('totals([{price:0.1,quantity:1},{price:0.2,quantity:1}],5)');
  assert.deepEqual({...totals},{subtotal:30,tax:2,total:32});
  assert.equal(app.run('line_cents({price:19.99,quantity:0.5})'),1000);
  assert.equal(app.run('totals([{price:50,quantity:1}],0.57).tax'),29);
  assert.equal(app.run('totals([{price:50,quantity:1}],1.13).tax'),57);
  assert.equal(app.run('totals([{price:100,quantity:1}],8.875).tax'),888);
  assert.equal(app.run('line_cents({price:10,quantity:0})'),0);
  for (const amount of ['-1','1.001','oops','Infinity','1e3','9007199254740992']) {
    assert.equal(app.run('minor_units(' + JSON.stringify(amount) + ')'),null);
  }
  assert.equal(app.run('line_cents({price:1,quantity:0.00001})'),null);
  assert.equal(app.run('totals([{price:1,quantity:1}],101)'),null);
  assert.equal(app.run('invoice.tax_rate=undefined;totals([{price:1,quantity:1}])'),null);
});

test('Invoice: local calendar defaults survive dates east of UTC', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    const app = harness('invoice',{invoice:collection(),items:collection()},{now:'2026-10-21T00:30:00+09:00'});
    assert.equal(app.run('invoice.date'),'2026-10-21');
    assert.equal(app.run('invoice.due_date'),'2026-10-28');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Invoice: reads the current event value before debouncing and serializes first-create and subsequent edits', async () => {
  let finish;
  const creates = [], updates = [];
  const app = harness('invoice',{
    invoice:collection([],{
      create:fields => { creates.push(fields); return new Promise(resolve => { finish=resolve; }); },
      update:async (id,fields) => updates.push({id,...fields})
    }),
    items:collection()
  });
  app.run('change_invoice("company_name",{currentTarget:{type:"text",value:"First name"}})');
  const pending = app.run('flush_invoice()');
  app.run('change_invoice("company_name",{currentTarget:{type:"text",value:"Second name"}})');
  const alsoPending = app.run('flush_invoice()');
  assert.equal(creates.length,1);
  assert.equal(creates[0].company_name,'First name');
  finish({id:'invoice1'});
  await Promise.all([pending,alsoPending]);
  assert.equal(updates.length,1);
  assert.equal(updates[0].id,'invoice1');
  assert.equal(updates[0].company_name,'Second name');
  assert.equal(app.run('header_pending'),null);
  assert.equal(app.run('dirty_count'),0);
});

test('Invoice: failed autosave retains edits, retries one header, and rejects invalid tax and dates', async () => {
  let offline = true;
  const writes = [];
  const app = harness('invoice',{
    invoice:collection([], {create:async fields => {if(offline) throw new Error('Offline'); writes.push(fields);return{id:'saved'};}}),
    items:collection()
  });
  app.run('invoice.company_name="Studio";save_invoice()');
  assert.equal(await app.run('flush_invoice()'),false);
  assert.match(app.run('save_error'),/could not be saved/);
  assert.equal(app.run('invoice.company_name'),'Studio');
  offline=false;
  assert.equal(await app.run('retry_saves()'),true);
  assert.equal(writes.length,1);
  app.run('invoice.tax_rate=-1;save_invoice()');
  assert.match(app.run('validation_error'),/tax rate/);
  app.run('invoice.tax_rate=0;invoice.date="2026-02-30";save_invoice()');
  assert.match(app.run('validation_error'),/valid dates/);
  app.run('invoice.date="2026-10-21";invoice.due_date="2026-10-20";save_invoice()');
  assert.match(app.run('validation_error'),/due date/);
  assert.equal(writes.length,1);
});

test('Invoice: row subscriptions preserve unsaved edits, persist the new input value, and clear the final deleted row', async () => {
  const writes = [], deletes = [];
  const rows = collection([{id:'item1',description:'Old',quantity:1,price:1}],{
    update:async (id,fields) => { writes.push({id,...fields}); return {id,...fields}; },
    delete:async id => deletes.push(id)
  });
  const app = harness('invoice',{invoice:collection(),items:rows});
  app.run('change_item(items[0],"description",{currentTarget:{type:"text",value:"New draft"}})');
  rows.emit([{id:'item1',description:'Old remote',quantity:1,price:1}]);
  assert.equal(app.run('items[0].description'),'New draft');
  await app.run('flush_item("item1")');
  assert.equal(writes[0].description,'New draft');
  assert.equal(app.run('dirty_count'),0);
  await app.run('remove_item("item1")');
  rows.emit([]);
  assert.equal(app.run('items.length'),0);
  assert.deepEqual(deletes,['item1']);
});

test('Invoice: failed item saves retain the draft through rollback and retry', async () => {
  let offline = true;
  const writes = [];
  const rows = collection([{id:'item1',description:'Work',quantity:1,price:10}],{
    update:async (id, fields) => { if(offline) throw new Error('Offline'); writes.push(fields); }
  });
  const app = harness('invoice',{invoice:collection(),items:rows});
  app.run('change_item(items[0],"price",{currentTarget:{type:"number",value:"20.25",valueAsNumber:20.25}})');
  assert.equal(await app.run('flush_item("item1")'),false);
  rows.emit([{id:'item1',description:'Work',quantity:1,price:10}]);
  assert.equal(app.run('items[0].price'),20.25);
  assert.match(app.run('item_error'),/could not be saved/);
  offline = false;
  assert.equal(await app.run('retry_saves()'),true);
  assert.equal(writes[0].price,20.25);
  assert.equal(app.run('dirty_count'),0);
});

test('Invoice: failed load retries both collections, and destroy flushes pending writes and releases subscriptions', async () => {
  let released = 0;
  const headers = [], rows = [];
  const app = harness('invoice',{
    invoice:collection([],{subscribe(_fn,_params,onError){onError(new Error('Offline'));return()=>released++;},list:async()=>[],create:async fields=>{headers.push(fields);return{id:'new'};}}),
    items:collection([],{subscribe(_fn,_params,onError){onError(new Error('Offline'));return()=>released++;},list:async()=>[{id:'row',description:'Item',quantity:1,price:0}],update:async(id,fields)=>rows.push(fields)})
  });
  assert.equal(app.run('invoice_loaded'),false);
  assert.match(app.run('load_error'),/Could not load/);
  await app.run('retry_load()');
  assert.equal(app.run('invoice_loaded && items_loaded'),true);
  app.run('invoice.company_name="Pending";save_invoice();items[0].price=12;save_item(items[0])');
  app.cleanup.forEach(fn=>fn());
  await flush();
  assert.equal(released,2);
  assert.equal(app.timers.size,0);
  assert.equal(headers[0].company_name,'Pending');
  assert.equal(rows[0].price,12);
});

test('Invoice: printing flushes the latest header and item before invoking print', async () => {
  const events=[];
  const app = harness('invoice',{
    invoice:collection([{id:'invoice1'}],{update:async()=>events.push('header')}),
    items:collection([{id:'item1',quantity:1,price:10}],{update:async()=>events.push('item')})
  },{print:()=>events.push('print')});
  app.run('items[0].description="Work";save_item(items[0])');
  await app.run('print_invoice()');
  assert.equal(events.at(-1),'print');
  assert.ok(events.includes('header'));
  assert.ok(events.includes('item'));
});

test('Time tracker: stop catches up without interval ticks and prevents duplicate session saves', async () => {
  const writes = [];
  const app = harness('time-tracker',{entries:collection([],{create:async fields=>{writes.push(fields);return{id:'e1'};}}),projects:collection()});
  app.run('timer_description="  Research  ";start_timer()');
  app.advance(125900);
  await app.run('stop_timer()');
  await app.run('stop_timer();save_timer()');
  assert.equal(writes.length,1);
  assert.equal(writes[0].duration,125);
  assert.equal(writes[0].description,'Research');
  assert.equal(app.run('timer_running'),false);
  assert.equal(app.run('timer_pending'),null);
  assert.equal(app.timers.size,0);
});

test('Time tracker: failed timer save keeps a frozen session for retry and blocks starting over', async () => {
  let offline = true, calls = 0;
  const writes = [];
  const app = harness('time-tracker',{entries:collection([],{create:async fields=>{calls++;if(offline)throw new Error('Offline');writes.push(fields);}}),projects:collection()});
  app.run('timer_description="Original";timer_billable=false;start_timer()');
  app.advance(9500);
  await app.run('stop_timer()');
  assert.match(app.run('timer_error'),/could not be saved/);
  app.run('timer_description="Different";timer_billable=true;start_timer()');
  assert.equal(app.run('timer_running'),false);
  app.advance(60000);
  offline=false;
  await app.run('save_timer()');
  assert.equal(calls,2);
  assert.equal(writes[0].duration,9);
  assert.equal(writes[0].description,'Original');
  assert.equal(writes[0].billable,false);
  assert.equal(app.run('timer_elapsed'),0);
});

test('Time tracker: validates complete times and dates and requires an explicit next day for overnight entries', async () => {
  const writes=[];
  const app=harness('time-tracker',{entries:collection([],{create:async fields=>writes.push(fields)}),projects:collection()});
  for(const [start,end] of [['','10:00'],['25:00','10:00'],['09:60','10:00'],['9:00','10:00'],['10:00','09:00'],['09:00','09:00']]) {
    assert.equal(app.run('calc_duration('+JSON.stringify(start)+','+JSON.stringify(end)+')'),null);
  }
  assert.equal(app.run('calc_duration("23:30","00:30",true)'),3600);
  app.run('open_manual_modal();form.date="2026-02-30"');
  await app.run('save_entry()');
  assert.match(app.run('form_error'),/valid date/);
  app.run('form.date="2026-10-21";form.start_time="23:30";form.end_time="00:30";form.next_day=true');
  await app.run('save_entry()');
  assert.equal(writes[0].duration,3600);
  assert.equal(writes[0].date,'2026-10-21');
  assert.equal(app.run('modal_open'),false);
});

test('Time tracker: editing only metadata preserves a timer entry shorter than one minute', async () => {
  const writes=[];
  const app=harness('time-tracker',{entries:collection([],{update:async(id,fields)=>writes.push({id,...fields})}),projects:collection()});
  app.run('open_edit_modal({id:"e1",date:"2026-10-21",start_time:"10:00",end_time:"10:00",duration:17,billable:true});form.description="Renamed"');
  await app.run('save_entry()');
  assert.equal(writes[0].duration,17);
  assert.equal(writes[0].description,'Renamed');
  assert.equal(writes[0].id,'e1');
});

test('Time tracker: a failed manual save keeps the open form and duplicate submissions create once', async () => {
  let fail,calls=0;
  const app=harness('time-tracker',{entries:collection([],{create:()=>{calls++;return new Promise((_,reject)=>{fail=reject;});}}),projects:collection()});
  app.run('open_manual_modal();form.description="Keep this"');
  const pending=app.run('save_entry()');
  await app.run('save_entry()');
  assert.equal(calls,1);
  app.run('close_modal()');
  assert.equal(app.run('modal_open'),true);
  fail(new Error('Offline'));
  await pending;
  assert.equal(app.run('form.description'),'Keep this');
  assert.equal(app.run('modal_open'),true);
  assert.match(app.run('form_error'),/could not save/i);
});

test('Time tracker: failed deletion keeps the entry dialog available for retry', async () => {
  const app=harness('time-tracker',{entries:collection([],{delete:async()=>{throw new Error('Offline');}}),projects:collection()});
  app.run('open_edit_modal({id:"e1",date:"2026-10-21",start_time:"09:00",end_time:"10:00",duration:3600})');
  await app.run('delete_entry("e1")');
  assert.equal(app.run('modal_open'),true);
  assert.equal(app.run('editing_entry.id'),'e1');
  assert.match(app.run('form_error'),/Could not delete/);
  assert.equal(app.run('saving'),false);
});

test('Time tracker: CSV quotes embedded commas/newlines/quotes, neutralizes formulas and preserves short durations', () => {
  const app=harness('time-tracker',{entries:collection(),projects:collection([{id:'p1',name:'Acme "Studio"'}])});
  const csv=app.run('timesheet_csv([{date:"2026-10-21",project_id:"p1",description:"=SUM(1,2)\\nQuoted \\"text\\"",start_time:"09:00",end_time:"09:00",duration:17,billable:true}])');
  assert.ok(csv.includes('"Acme ""Studio"""'));
  assert.ok(csv.includes('"'+"'"+'=SUM(1,2)\nQuoted ""text"""'));
  assert.ok(csv.includes('"0.004722"'));
  assert.equal(app.run('format_hours(17/3600)'),'17s');
});

test('Time tracker: local date filters include seven full days, exclude future entries, and work east of UTC', async () => {
  const previous=process.env.TZ;process.env.TZ='Asia/Tokyo';
  try {
    const writes=[];
    const app=harness('time-tracker',{entries:collection(),projects:collection()},{now:'2026-10-21T00:30:00+09:00'});
    assert.equal(app.run('today'),'2026-10-21');
    app.run('view="week";entries=[{id:"first",date:"2026-10-15"},{id:"last",date:"2026-10-21"},{id:"old",date:"2026-10-14"},{id:"future",date:"2026-10-22"}]');
    assert.equal(app.run('filter_entries().length'),2);
    app.run('open_manual_modal()');
    assert.equal(app.run('form.date'),'2026-10-21');
    assert.equal(app.run('format_date_header("2026-10-20")'),'Yesterday');
    assert.equal(writes.length,0);
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('Time tracker: failed project creation retains the name and load recovery releases every timer/subscription', async () => {
  let released=0;
  const app=harness('time-tracker',{
    entries:collection([],{subscribe(_fn,_params,onError){onError(new Error('Offline'));return()=>released++;},list:async()=>[]}),
    projects:collection([],{subscribe(_fn,_params,onError){onError(new Error('Offline'));return()=>released++;},list:async()=>[],create:async()=>{throw new Error('Offline');}})
  });
  assert.equal(app.run('entries_loaded'),false);
  await app.run('retry_load()');
  assert.equal(app.run('entries_loaded && projects_loaded'),true);
  app.run('project_name="Client work";project_form_open=true');
  await app.run('add_project()');
  assert.equal(app.run('project_name'),'Client work');
  assert.equal(app.run('project_form_open'),true);
  assert.match(app.run('project_error'),/Could not add/);
  app.mounts.forEach(fn=>{const cleanup=fn();if(cleanup)app.cleanup.push(cleanup);});
  app.run('start_timer()');
  assert.equal(app.timers.size,2);
  assert.equal(app.listeners.has('beforeunload'),true);
  const unload={preventDefault(){this.prevented=true;}};
  app.listeners.get('beforeunload')(unload);
  assert.equal(unload.prevented,true);
  app.cleanup.forEach(fn=>fn());
  assert.equal(app.timers.size,0);
  assert.equal(app.listeners.size,0);
  assert.equal(released,2);
});
