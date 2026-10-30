import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { parse } from 'acorn';

function loadTS(path, imports = {}) {
  const filename = new URL('../' + path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) {
    if (name.endsWith('.json')) return JSON.parse(readFileSync(new URL(name, filename), 'utf8'));
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  }});
  return exports;
}
const catalog = loadTS('src/lib/templates/index.ts');
const {transform_content_fields} = loadTS('src/lib/compiler/content-utils.ts', {
  marked: {marked: {parse: value => value}}
});

test('the picker offers a distinct starter set while older template URLs still resolve', () => {
  assert.equal(catalog.TEMPLATES.length, 20);
  assert.equal(new Set(catalog.TEMPLATES.map(template => template.id)).size, 20);
  assert.equal(catalog.get_template('habit-dashboard').id, 'habit-dashboard');
  assert.equal(catalog.get_template('dev-blog').id, 'dev-blog');
  assert.ok(!catalog.list_templates().some(template => template.id === 'dev-blog' || template.id === 'event-rsvp'));
  assert.ok(catalog.get_featured_kits_with_templates().every(kit => kit.templates.length > 0));
});

test('both picker groups keep featured apps and other templates searchable', () => {
  const expected = ['personal-crm', 'project-tracker', 'notes', 'kanban', 'bookmarks', 'habits', 'timer', 'expense', 'reading-list', 'recipes', 'goal-tracker', 'client-crm', 'invoice', 'time-tracker'];
  assert.deepEqual(Array.from(catalog.FEATURED_TEMPLATES, template => template.id), expected);
  const groups = catalog.get_template_groups(catalog.TEMPLATES);
  assert.deepEqual(Array.from(groups, group => group.templates.length), [14, 6]);
  assert.equal(groups[0].label, 'Featured apps');
  assert.equal(groups[1].label, 'More templates');
  const result = catalog.get_template_groups(catalog.TEMPLATES.filter(template => template.id === 'portfolio'));
  assert.equal(result.length, 1);
  assert.equal(result[0].templates[0].id, 'portfolio');
  assert.equal(catalog.get_template_groups([]).length, 0);
  assert.equal(catalog.TEMPLATES.length, 20);
});

for (const template of catalog.TEMPLATES) {
  test(`${template.name}: compiles for preview and publishing, with valid content and collection references`, () => {
    for (const generate of ['client', 'server']) compile(template.frontend_code, { filename: template.id + '.svelte', generate });
    const content = new Set(Object.keys(transform_content_fields(template.content, 'template-test')));
    const collections = new Set(Object.keys(template.data || {}));
    for (const [, id] of template.frontend_code.matchAll(/\bcontent\.(\w+)/g)) {
      assert.ok(content.has(id), `Missing content field ${id}`);
    }
    for (const [, id] of template.frontend_code.matchAll(/\bdata\.(\w+)\.(?:subscribe|create|update|delete|list|adjust)\(/g)) {
      assert.ok(collections.has(id), `Missing data collection ${id}`);
    }
  });
}

test('creating apps supports no kit, a selected kit, and per-app template identity', async () => {
  const writes = [];
  const { project_service } = loadTS('src/lib/services/project.svelte.ts', {
    '$lib/pocketbase.svelte': {pb: {collection: () => ({create: async value => {writes.push(value); return {id: `app-${writes.length}`, ...value, owner: 'builder'};}})}}
  });
  const blank = await project_service.create({name: 'Untitled app'});
  assert.equal(blank.kit, 'custom');
  assert.equal(blank.domain, '');
  const template = catalog.TEMPLATES[0];
  const app = await project_service.create({name:template.name, kit:'selected-kit', icon:template.preview, template_id:template.id});
  assert.equal(app.kit, 'selected-kit');
  assert.equal(app.settings.icon, template.preview);
  assert.equal(app.settings.template_id, template.id);
  await project_service.batch_create_kit('bundle', [template]);
  assert.equal(writes[2].settings.template_id, template.id);
});

function templateScript(id, collections) {
  const template = catalog.get_template(id);
  let script = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const imports = parse(script, {ecmaVersion:'latest', sourceType:'module'}).body.filter(node => node.type === 'ImportDeclaration');
  for (const node of imports.reverse()) script = script.slice(0, node.start) + script.slice(node.end);
  const timers = new Map();
  const cleanup = [];
  let timerId = 0;
  const context = vm.createContext({
    data: collections, content: Object.fromEntries(template.content.map(field => [field.id, field.value])),
    $state: value => value, $effect: () => {}, $derived: {by: fn => fn()},
    onDestroy: callback => cleanup.push(callback), console, window: {}, URL,
    crypto: {randomUUID: () => "created-record"},
    localStorage: {getItem: () => null, setItem: () => {}, removeItem: () => {}},
    setTimeout: callback => {timers.set(++timerId, callback); return timerId;},
    clearTimeout: id => timers.delete(id),
    setInterval: callback => {timers.set(++timerId, callback); return timerId;},
    clearInterval: id => timers.delete(id),
    Audio: class {play() {return Promise.resolve();}}
  });
  vm.runInContext(script, context);
  return {run: source => vm.runInContext(source, context), timers, cleanup};
}

test('Notes: switching notes flushes pending edits to their original note', async () => {
  const writes = [];
  const harness = templateScript('notes', {notes: {
    subscribe(callback) {callback([{id:'first', title:'First'}, {id:'second', title:'Second'}]); return () => {};},
    update: async (id, fields) => writes.push({id, fields})
  }});
  harness.run('debounced_save("first note text"); select_note("second"); debounced_save("second note text");');
  assert.equal(writes[0].id, 'first');
  assert.equal(writes[0].fields.content, 'first note text');
  await harness.run('flush_save()');
  assert.equal(writes[1].id, 'second');
  assert.equal(writes[1].fields.content, 'second note text');
  assert.equal(harness.timers.size, 0);
});

test('Notes: closing the app flushes the last edit and unsubscribes', () => {
  const writes = [];
  let unsubscribed = false;
  const harness = templateScript('notes', {notes: {
    subscribe(callback) {callback([{id:'note', title:'Note'}]); return () => {unsubscribed = true;};},
    update: async (id, fields) => writes.push({id, fields})
  }});
  harness.run('debounced_save("last edit")');
  harness.cleanup.forEach(callback => callback());
  assert.equal(writes[0].fields.content, 'last edit');
  assert.equal(unsubscribed, true);
  assert.equal(harness.timers.size, 0);
});

test('Focus timer: saves completed focus sessions and releases its timer on close', async () => {
  const sessions = [];
  let unsubscribed = false;
  const harness = templateScript('timer', {sessions: {
    subscribe(callback) {callback([]); return () => {unsubscribed = true;};},
    create: async record => sessions.push(record)
  }});
  harness.run('toggle_timer()');
  assert.equal(harness.timers.size, 1);
  await harness.run('complete_timer()');
  assert.equal(sessions[0].duration, 25 * 60);
  assert.equal(sessions[0].type, 'work');
  harness.run('toggle_timer()');
  harness.cleanup.forEach(callback => callback());
  assert.equal(unsubscribed, true);
  assert.equal(harness.timers.size, 0);
});

test('template previews isolate CRUD changes in memory without network requests', async () => {
  const {generate_memory_data_module} = await import('../src/lib/compiler/memory-data.js');
  const window = {};
  const db = vm.runInNewContext(generate_memory_data_module(['notes']).replace('export default collections;', 'collections'), {
    window, queueMicrotask, crypto: {randomUUID: () => 'new-note'}, fetch: () => {throw new Error('Preview must not use the network');}
  });
  const source = {notes:{records:[{id:'seed',title:'Original'}]}};
  window.__tk_update_data(source);
  const received = [];
  const unsubscribe = db.notes.subscribe(rows => received.push(rows));
  await db.notes.create({title:'New'});
  await db.notes.update('seed',{title:'Changed'});
  assert.equal((await db.notes.get('seed')).title, 'Changed');
  assert.equal(source.notes.records[0].title, 'Original');
  const result = await db.notes.list();
  result[0].title = 'Client-only edit';
  assert.equal((await db.notes.get('seed')).title, 'Changed');
  await db.notes.delete('new-note');
  assert.equal((await db.notes.list()).length, 1);
  unsubscribe();
  await new Promise(resolve => queueMicrotask(resolve));
  const count = received.length;
  await db.notes.update('seed',{title:'Unsubscribed'});
  assert.equal(received.length, count);
});

test('loading a template updates its icon without discarding app settings', async () => {
  let saved;
  const {POST} = loadTS('src/routes/api/projects/[id]/templates/+server.ts', {
    '@sveltejs/kit': {json: value => value},
    '$lib/templates': {get_template: catalog.get_template},
    '$lib/server/pb': {
      validateUserToken: async () => ({id:'user'}), unauthorizedResponse: () => ({}),
      getProject: async () => ({settings:{vibe_zone_enabled:false,services:{ai:{provider:'byok'}}}}),
      updateProject: async (_id, value) => {saved=value;}
    }
  });
  await POST({params:{id:'app'},request:{json:async()=>({templateId:'notes'})}});
  assert.equal(saved.settings.template_id, 'notes');
  assert.equal(saved.settings.icon, 'lucide:file-text');
  assert.equal(saved.settings.vibe_zone_enabled, false);
  assert.equal(saved.settings.services.ai.provider, 'byok');
});

test('new tracking apps start empty while gallery demos remain available and isolated', () => {
  for (const [id, collection] of [['kanban','cards'],['expense','transactions'],['reading-list','books'],['client-crm','clients'],['time-tracker','entries'],['invoice','invoice'],['goal-tracker','goals']]) {
    const template = catalog.get_template(id);
    assert.equal(template.data[collection].records.length, 0);
    const demo = catalog.get_template_preview_data(template);
    assert.ok(demo[collection].records.length > 0);
    demo[collection].records[0].id = 'changed';
    assert.notEqual(template.preview_records[collection][0].id, 'changed');
  }
  assert.ok(catalog.get_template('poll').data.options.records.every(option => option.votes === 0));
});

test('Bookmarks: invalid URLs show an error; valid links save without losing entered fields', async () => {
  const writes = [];
  const harness = templateScript('bookmarks', {bookmarks: {
    subscribe(callback) {callback([]); return () => {};},
    create: async value => writes.push(value)
  }});
  for (const input of ['not a URL', 'javascript:alert(1)']) {
    harness.run(`new_url = ${JSON.stringify(input)}`);
    await harness.run('add_bookmark()');
    assert.equal(writes.length, 0);
    assert.match(harness.run('form_error'), /valid http or https URL/);
  }
  harness.run('new_url="https://example.com"; new_title="Example"; new_tags="reference";');
  await harness.run('add_bookmark()');
  assert.equal(writes[0].url, 'https://example.com/');
  assert.equal(writes[0].title, 'Example');
  assert.equal(writes[0].tags, 'reference');
});
