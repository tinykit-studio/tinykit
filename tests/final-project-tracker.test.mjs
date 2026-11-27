import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {compile} from 'svelte/compiler';

const template = JSON.parse(readFileSync(new URL('../src/lib/templates/project-tracker.json', import.meta.url), 'utf8'));
const prevent = {preventDefault() {}};
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
function collection(records = [], operations = {}) {
  const subscribers = [], errors = [];
  let stops = 0;
  return {
    subscribe(callback, params, onError) {
      assert.equal(params.all, true);
      subscribers.push(callback); errors.push(onError); callback(records);
      return () => {stops++;};
    },
    list: async params => {assert.equal(params.all, true); return records;},
    create: async fields => ({id:'created', ...fields}), update: async () => {}, delete: async () => {},
    emit(rows, index = subscribers.length - 1) {subscribers[index](rows);},
    fail(index = errors.length - 1) {errors[index](Error('Offline'));},
    get stops() {return stops;}, ...operations
  };
}
function app(projects = collection(), tasks = collection(), mount = true) {
  let source = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const node of parse(source, {ecmaVersion:'latest', sourceType:'module'}).body.reverse()) {
    if (node.type === 'ImportDeclaration') source = source.slice(0, node.start) + source.slice(node.end);
    else if (node.type === 'VariableDeclaration' && node.declarations[0].init?.callee?.name === '$derived') {
      const declaration = node.declarations[0], expression = declaration.init.arguments[0];
      source = source.slice(0, node.start) + `Object.defineProperty(globalThis,${JSON.stringify(declaration.id.name)},{get:()=>(${source.slice(expression.start, expression.end)})});` + source.slice(node.end);
    }
  }
  const mounts = [], cleanup = [];
  const context = vm.createContext({data:{projects,tasks}, content:Object.fromEntries(template.content.map(field => [field.id, field.value])), $state:value => value, onMount:fn => mounts.push(fn), console});
  vm.runInContext(source, context);
  if (mount) mounts.forEach(fn => cleanup.push(fn()));
  return {run:code => vm.runInContext(code, context), close:() => cleanup.forEach(fn => fn()), context};
}
const records = [{id:'a',name:'Project A',status:'active'}, {id:'b',name:'Project B',status:'planned'}];

test('Project Tracker compiles for browser and server without warnings and preserves editable settings', () => {
  for (const generate of ['client','server']) assert.deepEqual(compile(template.frontend_code, {filename:'project-tracker.svelte',generate}).warnings, []);
  const content = new Set(template.content.map(field => field.id));
  for (const [,id] of template.frontend_code.matchAll(/\bcontent\.(\w+)/g)) assert.ok(content.has(id));
  for (const field of template.design) assert.ok(template.frontend_code.includes(`var(${field.css_var},`));
  assert.equal(template.data.projects.records.length, 0);
  assert.equal(template.data.tasks.records.length, 0);
  for (const slogan of ['A LITTLE CLARITY', 'Room for your next idea', 'A little focus goes a long way', 'Small steps.', 'Make space for']) assert.ok(!template.frontend_code.includes(slogan));
});

test('Project Tracker keeps failures separate across collections and recovers both with all records', async () => {
  let receiveTasks;
  const projects = collection(records), tasks = collection([], {
    subscribe(callback, params, onError) {assert.equal(params.all, true); receiveTasks = callback; onError(Error('Offline')); return () => {};},
    list: async params => {assert.equal(params.all, true); return [{id:'task',project_id:'a',title:'Task'}];}
  });
  const ui = app(projects, tasks);
  assert.equal(ui.run('ready'), false);
  assert.equal(ui.run('loadFailure'), 'Tasks could not be loaded.');
  projects.emit(records);
  assert.equal(ui.run('loadFailure'), 'Tasks could not be loaded.');
  ui.run('failure="Unrelated save failure"');
  await ui.run('retryLoad()');
  assert.equal(ui.run('ready'), true);
  assert.equal(ui.run('loadFailure'), '');
  assert.equal(ui.run('tasks[0].id'), 'task');
  assert.equal(ui.run('failure'), 'Unrelated save failure');
  receiveTasks([]);
  assert.equal(ui.run('ready'), true);
});

test('Project Tracker ignores old subscription generations and callbacks after close', () => {
  const projects = collection(records), tasks = collection();
  const ui = app(projects, tasks);
  ui.run('load()');
  projects.emit([{id:'stale',name:'Stale'}], 0); tasks.fail(0);
  assert.equal(ui.run('projects[0].id'), 'a');
  assert.equal(ui.run('loadFailure'), '');
  assert.equal(projects.stops, 1);
  ui.close();
  projects.emit([{id:'after-close'}]); tasks.fail();
  assert.equal(ui.run('projects[0].id'), 'a');
  assert.equal(ui.run('loadFailure'), '');
  assert.equal(projects.stops, 2);
});

test('Project Tracker retry ignores older list results and duplicate clicks', async () => {
  const projectRequest = deferred(), taskRequest = deferred();
  let calls = 0;
  const projects = collection(records, {list:params => {assert.equal(params.all,true); calls++; return projectRequest.promise;}});
  const tasks = collection([], {list:params => {assert.equal(params.all,true); return taskRequest.promise;}});
  const ui = app(projects,tasks);
  const pending = ui.run('retryLoad()'); await ui.run('retryLoad()');
  assert.equal(calls,1);
  projects.emit([{id:'live',name:'Live'}]);
  projectRequest.resolve([{id:'stale',name:'Stale'}]); taskRequest.resolve([{id:'fresh-task',project_id:'live'}]); await pending;
  assert.equal(ui.run('projects[0].id'),'live');
  assert.equal(ui.run('tasks[0].id'),'fresh-task');
  assert.equal(ui.run('retrying'),false);
});

test('Project Tracker does not apply a pending retry after teardown', async () => {
  const pending = deferred(), ui = app(collection(records,{list:() => pending.promise}), collection());
  const retry = ui.run('retryLoad()'); ui.close(); pending.resolve([{id:'after-close'}]); await retry;
  assert.equal(ui.run('projects[0].id'),'a');
});

test('Project Tracker saves an immutable project edit and does not close a different project edit', async () => {
  const pending = deferred(), writes = [];
  const ui = app(collection(records,{update:(id,fields) => {writes.push({id,fields}); return pending.promise;}}));
  ui.run('select(projects[0]); beginEdit(); edit.name="Updated A"; edit.notes="A notes"');
  const saving = ui.run('saveProject({preventDefault(){}})');
  ui.run('select(projects[1]); beginEdit(); edit.name="Unsaved B"');
  assert.equal(writes[0].id,'a');
  assert.equal(writes[0].fields.name,'Updated A');
  pending.resolve(); await saving;
  assert.equal(ui.run('selectedId'),'b');
  assert.equal(ui.run('edit.name'),'Unsaved B');
  assert.equal(ui.run('editing'),true);
  assert.equal(ui.run('busy'),false);
});

test('Project Tracker keeps a newer task draft and captures the original project during save', async () => {
  const pending = deferred(), writes = [];
  const ui = app(collection(records),collection([],{create:fields => {writes.push(fields); return pending.promise;}}));
  ui.run('select(projects[0]); newTask="First task"');
  const saving = ui.run('addTask({preventDefault(){}},selectedId)');
  ui.run('select(projects[1]); newTask="B draft"');
  assert.equal(writes[0].project_id,'a');
  assert.equal(writes[0].title,'First task');
  pending.resolve({id:'new-task'}); await saving;
  assert.equal(ui.run('newTask'),'B draft');
  assert.equal(ui.run('selectedId'),'b');
});

test('Project Tracker does not clear a changed task draft on the same project', async () => {
  const pending = deferred();
  const ui = app(collection(records),collection([],{create:() => pending.promise}));
  ui.run('select(projects[0]); newTask="First task"');
  const saving = ui.run('addTask({preventDefault(){}},selectedId)');
  ui.run('newTask="Newer draft"'); pending.resolve({id:'new-task'}); await saving;
  assert.equal(ui.run('newTask'),'Newer draft');
});

test('Project Tracker captures create fields and respects a later project selection', async () => {
  const pending = deferred(), writes = [];
  const ui = app(collection(records,{create:fields => {writes.push(fields); return pending.promise;}}));
  ui.run('projectName="New project"; description="Original description"; showCreate=true');
  const creating = ui.run('createProject({preventDefault(){}})');
  await ui.run('createProject({preventDefault(){}})');
  ui.run('select(projects[1]); projectName="Later draft"');
  assert.equal(writes.length,1);
  assert.equal(writes[0].name,'New project');
  pending.resolve({id:'created'}); await creating;
  assert.equal(ui.run('selectedId'),'b');
  assert.equal(ui.run('projectName'),'Later draft');
  assert.equal(ui.run('showCreate'),true);
});

test('Project Tracker validates deadlines and retains failed form input without reloading', async () => {
  let writes = 0;
  const ui = app(collection(records,{update:async () => {writes++; throw Error('Offline');}}));
  ui.run('select(projects[0]); beginEdit(); edit.name="Changed"; edit.due_date="2026-02-30"');
  await ui.run('saveProject({preventDefault(){}})');
  assert.equal(writes,0);
  assert.match(ui.run('failure'),/valid deadline/);
  ui.run('edit.due_date="2026-10-21"'); await ui.run('saveProject({preventDefault(){}})');
  assert.equal(writes,1);
  assert.equal(ui.run('edit.name'),'Changed');
  assert.equal(ui.run('editing'),true);
  assert.equal(ui.run('loadFailure'),'');
  assert.equal(ui.run('busy'),false);
});

test('Project Tracker restores a checkbox after a failed update and captures requested done state', async () => {
  const writes = [], ui = app(collection(records),collection([{id:'t',project_id:'a',title:'Task',done:false}],{update:async (id,fields) => {writes.push({id,fields}); throw Error('Offline');}}));
  ui.context.control = {checked:true};
  await ui.run('toggleTask(tasks[0],{currentTarget:control})');
  assert.equal(writes[0].id,'t');
  assert.equal(writes[0].fields.done,true);
  assert.equal(ui.context.control.checked,false);
  assert.match(ui.run('failure'),/Could not save/);
});

test('Project Tracker formats only valid local calendar dates', () => {
  const prior = process.env.TZ; process.env.TZ='America/Chicago';
  try {
    const ui = app();
    assert.match(ui.run('dateLabel("2026-10-21")'),/Oct 21/);
    for (const value of ['','invalid','2026-02-30','0000-01-01']) assert.equal(ui.run(`dateLabel(${JSON.stringify(value)})`),'No deadline');
    assert.equal(ui.run('parseDate("0099-01-02").getFullYear()'),99);
  } finally { if(prior===undefined) delete process.env.TZ; else process.env.TZ=prior; }
});
