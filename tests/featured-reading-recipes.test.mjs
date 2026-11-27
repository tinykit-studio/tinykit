import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const templates = Object.fromEntries(['reading-list', 'recipes'].map(id => [id, JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'))]));
function harness(id, collection, extras = {}) {
  const template = templates[id];
  let source = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const nodes = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  for (const node of nodes.reverse()) {
    if (node.type === 'ImportDeclaration') source = source.slice(0, node.start) + source.slice(node.end);
    else if (node.type === 'VariableDeclaration') {
      const declaration = node.declarations[0];
      if (declaration.init?.callee?.object?.name === '$derived') {
        const fn = declaration.init.arguments[0];
        source = source.slice(0, node.start) + `Object.defineProperty(globalThis, ${JSON.stringify(declaration.id.name)}, {get: () => (${source.slice(fn.start, fn.end)})()});` + source.slice(node.end);
      }
    }
  }
  const cleanup = [], mounts = [];
  const window = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ content: Object.fromEntries(template.content.map(field => [field.id, field.value])), data: { [id === 'reading-list' ? 'books' : id]: collection }, $state: value => value,
    onDestroy: fn => cleanup.push(fn), onMount: fn => mounts.push(fn), URL, window, console, asset: value => value, ...extras });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), cleanup, mounts, window };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function subscription(rows = []) {
  let receive, error, closed = false;
  return { subscribe(onRows, _params, onError) { receive = onRows; error = onError; onRows(rows); return () => closed = true; }, emit: rows => receive(rows), fail: () => error(Error('Offline')), get closed() { return closed; } };
}
for (const [id, template] of Object.entries(templates)) {
  test(`${id}: preview and published components compile without warnings`, () => {
    for (const generate of ['client', 'server']) assert.deepEqual(compile(template.frontend_code, { generate, filename: `${id}.svelte` }).warnings, []);
  });
  test(`${id}: loading errors stop the spinner, retries preserve records and mutations, and cleanup ignores late retries`, async () => {
    const sub = subscription([{ id: 'existing', title: 'Existing' }]);
    const pending = deferred();
    let attempt = 0;
    const app = harness(id, { ...sub, list: async () => { if (++attempt === 1) throw Error('Offline'); if (attempt === 2) return [{ id: 'loaded', title: 'Loaded' }]; return pending.promise; } });
    sub.fail();
    assert.equal(app.run('loading'), false);
    assert.match(app.run('load_error'), /Could not load/);
    app.run('action_error = "Mutation failed"');
    await app.run('retry_load()');
    assert.match(app.run('load_error'), /Could not load/);
    assert.equal(app.run('retrying_load'), false);
    await app.run('retry_load()');
    const name = id === 'reading-list' ? 'books' : 'recipes';
    assert.equal(app.run(`${name}[0].id`), 'loaded');
    assert.equal(app.run('load_error'), '');
    assert.equal(app.run('action_error'), 'Mutation failed');
    const retry = app.run('retry_load()');
    await app.run('retry_load()');
    app.cleanup.forEach(fn => fn());
    pending.resolve([{ id: 'late' }]); await retry;
    assert.equal(app.run(`${name}[0].id`), 'loaded');
    assert.equal(sub.closed, true);
  });
}

test('Reading list safely searches and sorts legacy empty fields without reordering subscription rows', () => {
  const rows = [{ id: 'a', title: 'Zulu', author: null, added_at: null }, { id: 'b', title: null, author: 'Ada', added_at: '2026-01-01' }];
  const app = harness('reading-list', subscription(rows));
  app.run('sort_by = "author"; search = "  aDa  "');
  assert.equal(app.run('filtered_books.length'), 1);
  assert.equal(app.run('filtered_books[0].id'), 'b');
  app.run('search = ""; sort_by = "added"');
  assert.equal(app.run('filtered_books[0].id'), 'b');
  assert.equal(rows[0].id, 'a');
  app.run('filter_status = "finished"');
  assert.equal(app.run('filtered_books.length'), 0);
});

test('Reading list validates titles/cover URLs, prevents duplicate creation, and edits only book metadata', async () => {
  const pending = deferred(), writes = [];
  const app = harness('reading-list', { ...subscription([{ id: 'existing', title: 'Old', status: 'finished', notes: 'Keep' }]), create: fields => { writes.push(['create', fields]); return pending.promise; }, update: async (id, fields) => writes.push([id, fields]) });
  app.run('new_title = "  "'); await app.run('add_book()');
  assert.match(app.run('form_error'), /title/);
  app.run('new_title = " New "; new_cover = "javascript:alert(1)"'); await app.run('add_book()');
  assert.match(app.run('form_error'), /http/);
  app.run('new_cover = " https://example.com/cover.png "; new_author = " Author "');
  const first = app.run('add_book()'); await app.run('add_book()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].title, 'New');
  assert.equal(writes[0][1].author, 'Author');
  assert.equal(writes[0][1].status, 'want');
  pending.resolve(); await first;
  app.run('open_form(books[0]); new_title = "Corrected"');
  await app.run('add_book()');
  assert.equal(writes[1][0], 'existing');
  assert.equal(writes[1][1].title, 'Corrected');
  assert.equal('status' in writes[1][1], false);
  assert.equal('notes' in writes[1][1], false);
});

test('Reading list failed writes keep the form/notes and reject invalid statuses or ratings', async () => {
  let updates = 0;
  const app = harness('reading-list', { ...subscription([{ id: 'book', title: 'Book' }]), create: async () => { throw Error('Offline'); }, update: async () => { updates += 1; throw Error('Offline'); }, delete: async () => { throw Error('Offline'); } });
  app.run('open_form(); new_title = "Keep this"'); await app.run('add_book()');
  assert.equal(app.run('new_title'), 'Keep this');
  assert.equal(app.run('show_form'), true);
  assert.equal(app.run('adding'), false);
  await app.run('update_status(books[0], "invalid")');
  await app.run('set_rating(books[0], 7)');
  assert.equal(updates, 0);
  assert.equal(await app.run('update_status(books[0], "reading")'), false);
  app.run('start_editing_notes(books[0]); notes_text = "Keep these notes"');
  await app.run('save_notes(books[0])');
  assert.equal(app.run('editing_notes'), 'book');
  assert.equal(app.run('notes_text'), 'Keep these notes');
  assert.match(app.run('action_error'), /notes/);
  app.run('pending_delete_id = "book"'); await app.run('delete_book(books[0])');
  assert.equal(app.run('pending_delete_id'), 'book');
  assert.match(app.run('action_error'), /delete/);
  assert.equal(app.run('busy_ids.length'), 0);
});

test('Reading list completion of a notes save cannot close or overwrite a newer book editor', async () => {
  const pending = deferred();
  const app = harness('reading-list', { ...subscription([{ id: 'a', notes: 'A' }, { id: 'b', notes: 'B' }]), update: () => pending.promise });
  app.run('start_editing_notes(books[0]); notes_text = "Edited A"');
  const save = app.run('save_notes(books[0])');
  app.run('start_editing_notes(books[1]); notes_text = "Edited B"');
  pending.resolve(); await save;
  assert.equal(app.run('editing_notes'), 'b');
  assert.equal(app.run('notes_text'), 'Edited B');
  app.run('start_editing_notes(books[0]); notes_text = "A draft"; start_editing_notes(books[1]); start_editing_notes(books[0])');
  assert.equal(app.run('notes_text'), 'A draft');
});

test('Reading list prevents duplicate deletes and keeps drafts until deletion succeeds', async () => {
  const pending = deferred(); let deletes = 0;
  const app = harness('reading-list', { ...subscription([{ id: 'a' }, { id: 'b' }]), delete: () => { deletes += 1; return pending.promise; } });
  app.run('start_editing_notes(books[0]); notes_text = "Draft"; start_editing_notes(books[1]); pending_delete_id = "a"');
  const deletion = app.run('delete_book(books[0])'); await app.run('delete_book(books[0])');
  assert.equal(deletes, 1);
  assert.equal(app.run('notes_drafts.get("a")'), 'Draft');
  pending.resolve(); await deletion;
  assert.equal(app.run('notes_drafts.has("a")'), false);
  assert.equal(app.run('pending_delete_id'), null);
});

test('Recipes preserves an edit draft through data refreshes and handles an initial edit link after loading', () => {
  let receive;
  const window = { location: { hash: '#/edit/recipe' }, addEventListener() {}, removeEventListener() {} };
  const app = harness('recipes', { subscribe(onRows) { receive = onRows; return () => {}; } }, { window });
  app.mounts[0]();
  assert.equal(app.run('loading'), true);
  receive([{ id: 'recipe', title: 'Original', servings: 4, image: 'photo.png' }]);
  assert.equal(app.run('view'), 'form');
  app.run('form.title = "Unsaved title"; form.ingredients = "My ingredients"');
  receive([{ id: 'recipe', title: 'Server update', servings: 6 }]);
  assert.equal(app.run('form.title'), 'Unsaved title');
  assert.equal(app.run('form.ingredients'), 'My ingredients');
  assert.equal(app.run('form.image'), null);
});

test('Recipes trims search/category values, handles missing fields and deduplicates live rows', () => {
  const app = harness('recipes', subscription([{ id: 'a', title: 'Lentils', ingredients: null, category: ' Dinner ' }, { id: 'b', title: null, ingredients: 'Salt', category: null }, { id: 'a', title: 'Lentil soup', category: ' Dinner ' }]));
  assert.equal(app.run('recipes.length'), 2);
  app.run('search = "  lentil  "; filter_category = "Dinner"');
  assert.equal(app.run('filtered_recipes.length'), 1);
  assert.equal(app.run('categories[0]'), 'Dinner');
  app.run('search = "  SALT "; filter_category = ""');
  assert.equal(app.run('filtered_recipes[0].id'), 'b');
  assert.equal(app.run('parse_list("  one  \\r\\n\\n two ").join("|")'), 'one|two');
});

test('Recipes validates positive whole servings and source URLs before saving', async () => {
  const writes = [];
  const app = harness('recipes', { ...subscription(), create: async fields => writes.push(fields) });
  app.run('form.title = " Recipe "; form.servings = "2.5"'); await app.run('save_recipe()');
  assert.match(app.run('form_error'), /whole number/);
  app.run('form.servings = 0'); await app.run('save_recipe()');
  assert.equal(writes.length, 0);
  app.run('form.servings = 4; form.source_url = "javascript:alert(1)"'); await app.run('save_recipe()');
  assert.match(app.run('form_error'), /http/);
  app.run('form.source_url = " https://example.com/recipe "'); await app.run('save_recipe()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].servings, 4);
  assert.equal(writes[0].title, 'Recipe');
  assert.equal(writes[0].source_url, 'https://example.com/recipe');
});

test('Recipes save failures retain fields and photos; repeated saves/deletes wait for the first request', async () => {
  const pending = deferred(); let writes = 0, deletes = 0;
  const app = harness('recipes', { ...subscription([{ id: 'recipe', title: 'Existing' }]), update: () => { writes += 1; return pending.promise; }, delete: async () => { deletes += 1; throw Error('Offline'); } });
  app.mounts[0](); app.run('navigate_to("/edit/recipe"); form.title = "Edited title"; form.image = {type: "image/png", size: 10}');
  const save = app.run('save_recipe()'); await app.run('save_recipe()');
  assert.equal(writes, 1);
  pending.reject(Error('Offline')); await save;
  assert.equal(app.run('view'), 'form');
  assert.equal(app.run('form.title'), 'Edited title');
  assert.equal(app.run('form.image.size'), 10);
  assert.match(app.run('form_error'), /Could not save/);
  app.run('view_recipe("recipe")');
  const deletion = app.run('delete_recipe()'); await app.run('delete_recipe()'); await deletion;
  assert.equal(deletes, 1);
  assert.equal(app.run('view'), 'detail');
  assert.match(app.run('action_error'), /Could not delete/);
  assert.equal(app.run('deleting'), false);
});

test('Recipes imports nested recipe instructions and numeric yields without overwriting concurrent typing', async () => {
  const pending = deferred();
  const schema = { '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: 'Imported recipe', description: 'A &amp; B', recipeYield: '4 servings', recipeIngredient: ['1 cup flour'], recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ text: 'Mix' }, 'Cook'] }], totalTime: 'PT1H30M' }] };
  class DOMParser {
    parseFromString(value) { return value === 'HTML' ? { querySelectorAll: () => [{ textContent: JSON.stringify(schema) }] } : { body: { textContent: value.replace('&amp;', '&') } }; }
  }
  const app = harness('recipes', subscription(), { proxy: () => pending.promise, DOMParser });
  app.run('fetch_url = " https://example.com/recipe "');
  const request = app.run('fetch_recipe()');
  app.run('form.title = "My title"');
  pending.resolve({ ok: true, text: async () => 'HTML' }); await request;
  assert.equal(app.run('form.title'), 'My title');
  assert.equal(app.run('form.description'), 'A & B');
  assert.equal(app.run('form.servings'), '4');
  assert.equal(app.run('form.instructions'), 'Mix\nCook');
  assert.equal(app.run('form.prep_time'), '1 hr 30 min');
  assert.equal(app.run('is_fetching'), false);
});

test('Recipes rejects unsafe import URLs, preserves failures for retry, and ignores imports after leaving', async () => {
  const pending = deferred(); let requests = 0;
  const app = harness('recipes', subscription(), { proxy: () => { requests += 1; return requests === 1 ? Promise.resolve({ ok: false }) : pending.promise; } });
  app.run('fetch_url = "file:///private"'); await app.run('fetch_recipe()');
  assert.equal(requests, 0);
  assert.match(app.run('import_error'), /http/);
  app.run('fetch_url = "https://example.com/recipe"'); await app.run('fetch_recipe()');
  assert.equal(app.run('fetch_url'), 'https://example.com/recipe');
  assert.match(app.run('import_error'), /Could not import/);
  app.run('navigate_to("/new"); fetch_url = "https://example.com/recipe"');
  const request = app.run('fetch_recipe()');
  app.run('navigate_to("/")');
  pending.resolve({ ok: true, text: async () => 'HTML' }); await request;
  assert.equal(app.run('form.title'), '');
  assert.equal(app.run('view'), 'list');
  assert.equal(app.run('is_fetching'), false);
});

test('Recipes retains detail content while an optimistic deletion is pending and restores it on failure', async () => {
  const sub = subscription([{ id: 'recipe', title: 'Recipe' }]);
  const pending = deferred();
  const app = harness('recipes', { ...sub, delete: () => { sub.emit([]); return pending.promise; } });
  app.mounts[0](); app.run('view_recipe("recipe")');
  const deletion = app.run('delete_recipe()');
  assert.equal(app.run('selected_recipe.title'), 'Recipe');
  assert.equal(app.run('deleting'), true);
  sub.emit([{ id: 'recipe', title: 'Recipe' }]);
  pending.reject(Error('Offline')); await deletion;
  assert.equal(app.run('selected_recipe.title'), 'Recipe');
  assert.equal(app.run('deleting_recipe'), null);
  assert.match(app.run('action_error'), /Could not delete/);
});

test('Recipes does not redirect a newer route after an earlier save resolves', async () => {
  const pending = deferred();
  const app = harness('recipes', { ...subscription([{ id: 'existing', title: 'Existing' }]), create: () => pending.promise });
  app.mounts[0](); app.run('start_new_recipe(); form.title = "New recipe"');
  const save = app.run('save_recipe()');
  app.run('view_recipe("existing")');
  pending.resolve(); await save;
  assert.equal(app.run('view'), 'detail');
  assert.equal(app.run('selected_id'), 'existing');
});
